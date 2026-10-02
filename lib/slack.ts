// Chat notifications: the high-level helpers the app calls after schedule changes.
//
// This module decides WHO gets told WHAT and WHEN. It no longer knows how to talk
// to a chat provider — that's lib/chatTransport (an abstract class plus one
// subclass per provider), so the same notifiers work for Slack today and Discord
// later without any of them changing. Every function here gets its transport from
// `transportForOrg`/`orgMessagingContext` and never sees a token.
//
// (The filename is historical: Slack is currently the only provider. The Slack
// specifics all live in lib/integrations/slack/.)
//
// Two hard rules keep this safe to sprinkle through the mutation routes, and both
// are enforced by the transport base class:
//   1. Everything no-ops when the org hasn't connected an integration, so the app
//      identically without a provider configured (dev/test/CI).
//   2. Nothing throws — an outage must never break a db mutation. Failures are
//      logged and swallowed; helpers return false/null instead.
//
// This module is server-only (it imports prisma). The client talks to it via the
// API routes, never by importing it directly.
import { prisma } from "./prisma";
import { membersTargetedBy } from "./availabilityTargets";
import { orderedRoles, roleLabel, type TeamRoleDef } from "./teamRoles";
import { getTeamCatalog } from "./teamRoleStore";
import type { Prisma } from "./generated/prisma/client";
import { createOrSyncSetPlaylist, isOrgSpotifyConnected } from "./spotify";
import {
  ALL_INSTRUMENTS,
  DIGEST_WINDOW_END_MINUTE,
  DIGEST_WINDOW_START_MINUTE,
  type Instrument,
} from "./constants";
import { buildOrgDigest, renderDigestText } from "./digest";
import {
  notificationEnabled,
  parseNotificationPrefs,
  type NotificationType,
} from "./notificationPrefs";
import { formatDay, formatTime, shortDateLabel } from "./dates";
import { isUserAvailable, type UnavailabilityRule } from "./scheduler";
import { setLinkPath } from "./setLink";
import {
  DM_FIELDS,
  isOrgMessagingConnected,
  orgMessagingContext,
  transportForCredential,
  transportForOrg,
  type MessageFormat,
  type MessagingTransport,
} from "./orgIntegration";
import { SLACK_FORMAT } from "./integrations/slack";

// Re-exported under its old name: the API routes and UI have called this since
// Slack was the only option, and it means the same thing now.
export { isOrgMessagingConnected as isOrgSlackConnected };

/** What one attempted link did: cached an id, harmlessly did nothing, or broke. */
type LinkOutcome = "linked" | "skipped" | "failed";

/**
 * Resolve one membership's member id from the person's email and cache it on the
 * row. The (orgId, slackUserId) unique guard can trip when two app accounts
 * share one integration account — a "skipped", never a thrown error, so a sweep
 * over many rows keeps going.
 */
async function linkMembershipByEmail(
  membershipId: string,
  messaging: MessagingTransport,
  email: string
): Promise<LinkOutcome> {
  // Not every provider can do this at all — Discord exposes no member email at
  // any permission level. Checking the capability keeps "this provider can't"
  // distinct from "this person isn't in the workspace".
  if (!messaging.capabilities.emailLookup) return "skipped";
  const lookup = await messaging.lookupUserIdByEmail(email);
  // A failure is reported UP rather than swallowed: the sweep has to be able to
  // tell "we asked about everyone and matched nobody" from "we never got an
  // answer", because only the second one is worth interrupting an admin over.
  if (lookup.kind === "failed") return "failed";
  if (lookup.kind === "not-found") return "skipped";
  return prisma.orgMembership
    .update({ where: { id: membershipId }, data: { slackUserId: lookup.userId } })
    .then<LinkOutcome>(() => "linked")
    .catch<LinkOutcome>(() => "skipped");
}

/**
 * One batch of the org-wide "Sync team members" sweep (Org settings → Slack).
 *
 * Deliberately NOT a single call that walks the whole org: the lookups are
 * serial and paced, so a big org outlives a serverless function's time budget —
 * which is exactly how the old install-time sweep managed to half-finish in
 * silence. The client drives it instead, one window at a time, which also gives
 * it something honest to draw a progress bar from.
 */
export type SlackSyncBatch = {
  /** People in the org — the denominator of both the bar and "x/y synced". */
  total: number;
  /** How many we have been through once this batch is in (the bar's numerator). */
  processed: number;
  /** How many we resolved to a member id in THIS batch. The caller sums them. */
  matched: number;
  /** How many of the org's people hold a member id right now (the "x" of x/y). */
  synced: number;
  /**
   * Lookups that got no answer at all in this batch — a rejected request, a bad
   * token, a rate limit we couldn't ride out. Non-zero means the sweep is
   * BROKEN, not that nobody matched, and the caller must say so rather than
   * reporting a clean run.
   */
  failed: number;
  /** No more people after this batch. */
  done: boolean;
};

/**
 * Look up `limit` of an org's people (starting at `offset`) by email and cache
 * what comes back on their OrgMembership. Returns null when the org can't do
 * this at all — no integration connected, or one with no email lookup.
 *
 * Re-checks people who ALREADY have an id on purpose: after connecting a
 * different workspace every stored id is from the old one, and a fresh lookup is
 * what replaces it. A lookup that misses leaves the stored id alone rather than
 * clearing it — a miss is usually a transient failure or an email that simply
 * isn't in the workspace, and neither is a reason to throw away an id somebody
 * may have set by hand.
 */
export async function syncOrgSlackIds(
  orgId: string,
  offset: number,
  limit: number
): Promise<SlackSyncBatch | null> {
  const messaging = await transportForOrg(orgId);
  if (!messaging?.capabilities.emailLookup) return null;

  // Ordered by id so the client's successive windows tile the org exactly once.
  const [total, rows] = await Promise.all([
    prisma.orgMembership.count({ where: { orgId } }),
    prisma.orgMembership.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      skip: offset,
      take: limit,
      select: { id: true, user: { select: { email: true } } },
    }),
  ]);

  let matched = 0;
  let failed = 0;
  for (const row of rows) {
    // No email = nothing to look up. They still count as processed: the bar
    // walks the whole org, not just the part of it we can search.
    if (!row.user.email) continue;
    const outcome = await linkMembershipByEmail(row.id, messaging, row.user.email);
    if (outcome === "linked") matched++;
    // Stop at the first failure instead of grinding through the rest. When the
    // lookup is broken — a rejected request, a bad token — it is broken for
    // everyone, and walking the whole org to say so just makes the admin wait
    // longer for the same bad news.
    if (outcome === "failed") {
      failed++;
      break;
    }
  }

  // Counted after the writes, so the number the admin reads at the end includes
  // this batch. It's the whole org's tally, not a running sum of `matched` —
  // people already linked before the sweep count too.
  const synced = await prisma.orgMembership.count({
    where: { orgId, slackUserId: { not: null } },
  });

  return {
    total,
    processed: Math.min(offset + rows.length, total),
    matched,
    synced,
    failed,
    done: rows.length < limit,
  };
}

/**
 * The other half of syncOrgSlackIds: link ONE person in every org they belong to
 * that doesn't have their member id yet. Called on every sign-in (lib/auth.ts)
 * and right after redeeming an org key, which between them cover everybody an
 * admin's last sweep couldn't see — accounts created since, people who joined an
 * org since, and anyone whose integration account didn't exist yet. That keeps
 * the manual field in /profile a fallback rather than a chore.
 *
 * Orgs with no bot installed are filtered out in the query, so the usual "nothing
 * to do" case costs one cheap read and zero API calls. Never throws.
 */
export async function linkSlackIdForUser(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  // No email = nothing to look up (and a placeholder row that was never claimed
  // has no integration account waiting for it either).
  if (!user?.email) return;

  const rows = await prisma.orgMembership.findMany({
    where: {
      userId,
      slackUserId: null,
      // No credential means no workspace to search, so skip those orgs entirely.
      org: { slackBotToken: { not: null } },
    },
    select: { id: true, org: { select: { slackBotToken: true } } },
  });

  // Build each org's transport from the credential this query already read,
  // rather than re-reading the org row per membership.
  for (const row of rows) {
    const messaging = transportForCredential(row.org.slackBotToken);
    if (!messaging) continue;
    await linkMembershipByEmail(row.id, messaging, user.email);
  }
}

// ── Message-text helpers ──────────────────────────────────────────────────

export type SetLike = { label: string | null; startsAt: Date };

function setLabel(set: SetLike): string {
  const name = set.label ?? "the worship set";
  return `${name} on ${formatDay(set.startsAt)} at ${formatTime(set.startsAt)}`;
}

// The channel topic doubles as a readable name: "<date>-<set name>".
function setTopicName(set: SetLike): string {
  const name = set.label ?? "Worship Set";
  return `${shortDateLabel(set.startsAt)}-${name}`;
}

// A Slack channel name from a set: lowercase, only a-z/0-9/hyphen, ≤72 chars
// (leaving room for the collision-retry suffix). Name first, date second —
// e.g. "large-group-9-4-26" — so the channel list sorts by set, not by date.
function channelNameForSet(set: SetLike): string {
  return `${set.label ?? "worship-set"}-${shortDateLabel(set.startsAt)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

// "Worship Leader: Alice\nVocals: Bob, Carol\n…" in scarce-first role order,
// skipping roles nobody is filling.
export function teamRosterText(
  assignments: { role: Instrument; user: { name: string } }[],
  // The set's team catalog, so roles read in that team's own names and order.
  // Omitted → the built-in ordering, with unknown keys humanized by roleLabel.
  catalog?: TeamRoleDef[],
  // The provider's markup. Defaults to Slack's so the existing output (and its
  // tests) are unchanged; real callers pass `messaging.fmt`.
  fmt: MessageFormat = SLACK_FORMAT
): string {
  const namesByRole = new Map<Instrument, string[]>();
  for (const a of assignments) {
    const names = namesByRole.get(a.role) ?? [];
    names.push(a.user.name);
    namesByRole.set(a.role, names);
  }
  const order = catalog?.length
    ? orderedRoles(catalog).map((r) => r.key)
    : ALL_INSTRUMENTS;
  // Anything the catalog doesn't mention (a role the team has since dropped)
  // still gets listed, after the roles it does.
  const extras = [...namesByRole.keys()].filter((r) => !order.includes(r));
  return [...order, ...extras]
    .filter((role) => namesByRole.has(role))
    .map(
      (role) =>
        `${fmt.bold(`${roleLabel(role, catalog)}:`)} ${namesByRole.get(role)!.join(", ")}`
    )
    .join("\n");
}

function appUrl(path = ""): string {
  const base = process.env.NEXTAUTH_URL ?? "";
  return base ? `${base}${path}` : "";
}

// ── High-level notifications (called from the mutation routes) ─────────────

/**
 * A user just requested a swap out of their slot. DM everyone else who plays
 * that instrument so they can pick it up.
 */
export async function notifySwapRequested(assignmentId: string): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      // The requester's name and their note (swapReason) both go in the DM, so
      // the ask reads as coming from a person rather than from the system.
      user: { select: { name: true } },
      set: {
        select: {
          label: true,
          startsAt: true,
          durationMinutes: true,
          orgId: true,
          teamId: true,
        },
      },
    },
  });
  if (!assignment) return;
  const dm = await orgMessagingContext(assignment.set.orgId, "COVER_REQUESTED");
  if (!dm) return;

  // Same eligibility rule as GET /api/swaps: plays this role, isn't the
  // requester, is in the set's org, is on the set's team (a team-less set is
  // open to the whole org), and has linked Slack in THAT org (so people who
  // never connected Slack are simply skipped — the graceful-fail path).
  //
  // Roles are PER TEAM (TeamMember.roles), so the role test has to name the
  // team: on the set's own team for a team-assigned set, or on any team in this
  // org for a team-less one. (This used to read the deprecated User.instruments
  // + User.teams, which nothing writes anymore — so it matched nobody and the
  // DM silently went out to an empty list.)
  const playsRole: Prisma.UserWhereInput = {
    teamMembers: {
      some: {
        roles: { has: assignment.role },
        ...(assignment.set.teamId
          ? { teamId: assignment.set.teamId }
          : { team: { orgId: assignment.set.orgId } }),
      },
    },
  };
  const eligible = await prisma.orgMembership.findMany({
    where: {
      orgId: assignment.set.orgId,
      userId: { not: assignment.userId },
      slackUserId: { not: null },
      user: playsRole,
    },
    select: {
      ...DM_FIELDS,
      userId: true,
      // Busy blocks are global to the person (they apply in every org), so we
      // can filter out anyone unavailable at this set's time before DMing.
      user: {
        select: {
          unavailability: {
            select: {
              type: true,
              dayOfWeek: true,
              startMinute: true,
              endMinute: true,
              startDate: true,
              endDate: true,
            },
          },
        },
      },
    },
  });

  // Drop anyone whose availability blocks this set's day/time — no point
  // pinging people who already said they can't serve then.
  const schedulerSet = {
    id: assignmentId,
    startsAt: assignment.set.startsAt,
    durationMinutes: assignment.set.durationMinutes,
    teamId: assignment.set.teamId,
  };
  const available = eligible.filter((m) => {
    const rules: UnavailabilityRule[] = m.user.unavailability.map((u) => ({
      ...u,
      userId: m.userId,
    }));
    return isUserAvailable(m.userId, schedulerSet, rules);
  });

  // Deep link: the tab opens with this set's roster up and its row ringed, so
  // "take it" is right there rather than somewhere down a list.
  const url = appUrl(setLinkPath(assignment.setId, "set-manager"));
  // The note is optional, so it either replaces the closing full stop or the
  // sentence just ends — never a dangling `: ""`.
  const note = assignment.swapReason ? `: "${assignment.swapReason}"` : ".";
  const text =
    `🎚️ ${assignment.user.name} is requesting someone to cover for ` +
    `${setLabel(assignment.set)}${note}` +
    (url ? ` Take it here: ${url}` : "");

  // Queued through the shared rate limiter (lib/rateLimit), so this fans out in
  // call order at a safe pace rather than as one burst.
  await Promise.all(
    available.map((m) => dm.messaging.postDm(m, text))
  );
}

/**
 * Someone took over a swap. DM the person who gave it up so they know it's
 * covered. `takerName`/`previousOwnerId` are captured before the db update
 * reassigns the row.
 */
export async function notifySwapTaken(
  assignmentId: string,
  previousOwnerId: string,
  takerName: string
): Promise<void> {
  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { set: { select: { label: true, startsAt: true, orgId: true } } },
  });
  if (!assignment) return;
  const dm = await orgMessagingContext(assignment.set.orgId, "COVER_TAKEN");
  if (!dm) return;

  const owner = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: previousOwnerId, orgId: assignment.set.orgId } },
    select: DM_FIELDS,
  });
  if (!owner?.slackUserId) return;

  // "Pending approval" is the honest state: the take moved the seat, but an
  // admin can still reject it and hand the slot straight back to this person.
  const text =
    `✅ ${takerName} is covering your ${roleLabel(assignment.role)} slot on ` +
    `${setLabel(assignment.set)}! Now pending approval from admins.`;
  await dm.messaging.postDm(owner, text);
}

// A proposal's two sets + the org they share, plus each party's per-org Slack
// id and the token to DM with. Shared by the targeted-swap notifications below,
// which differ only in who they message and about what — so the "should this
// org still send this?" check happens here too, keyed by `type`.
async function loadProposalSlack(proposalId: string, type: NotificationType) {
  const p = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      fromAssignment: {
        select: {
          role: true,
          // setId on both sides: the DMs below link to whichever set is the
          // recipient's business (see setLinkPath).
          setId: true,
          set: { select: { label: true, startsAt: true, orgId: true } },
        },
      },
      toAssignment: {
        select: {
          userId: true,
          setId: true,
          user: { select: { name: true } },
          set: { select: { label: true, startsAt: true } },
        },
      },
    },
  });
  if (!p) return null;
  const orgId = p.fromAssignment.set.orgId;
  // The type is passed in because both DMs below load a proposal exactly the
  // same way — only which switch they answer to differs.
  const dm = await orgMessagingContext(orgId, type);
  if (!dm) return null;
  // Per-org Slack ids for the two parties.
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, userId: { in: [p.requestedById, p.toAssignment.userId] } },
    select: { ...DM_FIELDS, userId: true },
  });
  // The membership row (not just the Slack id) so DMs can use the cached channel.
  const memberFor = (userId: string) =>
    memberships.find((m) => m.userId === userId && m.slackUserId) ?? null;
  return { p, messaging: dm.messaging, memberFor };
}

/**
 * A targeted swap was proposed. DM the recipient (who'd give up their slot) so
 * they can accept or reject it. No-op if they haven't linked Slack.
 */
export async function notifySwapProposed(proposalId: string): Promise<void> {
  const loaded = await loadProposalSlack(proposalId, "SWAP_PROPOSED");
  if (!loaded) return;
  const { p, messaging, memberFor } = loaded;
  const member = memberFor(p.toAssignment.userId);
  if (!member) return;

  // Their row on that tab is the incoming proposal, keyed to the set they'd
  // take on — so that's the set the link opens.
  const url = appUrl(setLinkPath(p.fromAssignment.setId, "set-manager"));
  const text =
    `🔁 ${p.requestedBy.name} wants to swap their ` +
    `${roleLabel(p.fromAssignment.role)} slot on ` +
    `${setLabel(p.fromAssignment.set)} for yours on ` +
    `${setLabel(p.toAssignment.set)}.` +
    (url ? ` Accept or decline here: ${url}` : "");
  await messaging.postDm(member, text);
}

/**
 * A targeted swap was accepted or rejected. DM the requester with the outcome.
 * No-op if they haven't linked Slack.
 */
export async function notifySwapResolved(
  proposalId: string,
  accepted: boolean
): Promise<void> {
  const loaded = await loadProposalSlack(proposalId, "SWAP_RESOLVED");
  if (!loaded) return;
  const { p, messaging, memberFor } = loaded;
  const member = memberFor(p.requestedById);
  if (!member) return;

  const who = p.toAssignment.user.name;
  // Either way the link goes to the set that's THEIRS now: the one they took on
  // if it was accepted, the one they kept if it wasn't.
  const url = appUrl(
    setLinkPath(
      accepted ? p.toAssignment.setId : p.fromAssignment.setId,
      "set-manager"
    )
  );
  const text =
    (accepted
      ? `✅ ${who} accepted your swap — you're now on ` +
        `${setLabel(p.toAssignment.set)} and they've got ` +
        `${setLabel(p.fromAssignment.set)}.`
      : `🚫 ${who} declined your swap for ` +
        `${setLabel(p.fromAssignment.set)}. Your slot is unchanged.`) +
    (url ? ` See it here: ${url}` : "");
  await messaging.postDm(member, text);
}

/**
 * An admin opened a new availability request. DM every member of the
 * request's org with linked Slack asking them to fill it in.
 */
export async function notifyAvailabilityRequest(request: {
  name: string | null;
  startDate: Date;
  endDate: Date;
  orgId: string;
  // The teams the request targets; empty = the whole org (lib/availabilityTargets).
  teams: { id: string }[];
}): Promise<void> {
  const dm = await orgMessagingContext(request.orgId, "AVAILABILITY_REQUEST");
  if (!dm) return;

  const teamIds = request.teams.map((t) => t.id);
  const members = await prisma.orgMembership.findMany({
    where: {
      orgId: request.orgId,
      slackUserId: { not: null },
      // Exactly who the app puts on the hook for this request — an ACTIVE
      // membership on a targeted team, no roles needed (lib/availabilityTargets).
      // Shared with targetsUser so the DM can't nag someone the Availabilities
      // tab never asks.
      ...membersTargetedBy(request.orgId, teamIds),
    },
    select: DM_FIELDS,
  });

  const label =
    request.name ??
    `${formatDay(request.startDate)} – ${formatDay(request.endDate)}`;
  const url = appUrl("/schedule");
  const text =
    `📅 Please enter your availability for ${dm.messaging.fmt.bold(label)}.` +
    (url ? ` ${url}` : "");

  await Promise.all(members.map((m) => dm.messaging.postDm(m, text)));
}

/**
 * A cover-take or accepted swap just entered PENDING_APPROVAL. DM every admin
 * of the set's org (with linked Slack) so they know something's waiting on the
 * Approvals tab. Fire-and-forget; no-op without Slack.
 */
export async function notifyAdminsPendingApproval(
  orgId: string,
  // A cover names both sides (who is covering for whom) — that's the whole
  // decision the admin is making. A targeted swap is still described by role,
  // since "covering for" doesn't fit a two-way trade.
  info:
    | { kind: "cover"; set: SetLike; taker: string; previousOwner: string }
    | { kind: "swap"; role: Instrument; set: SetLike }
): Promise<void> {
  const dm = await orgMessagingContext(orgId, "APPROVAL_PENDING");
  if (!dm) return;

  const admins = await prisma.orgMembership.findMany({
    where: { orgId, isAdmin: true, slackUserId: { not: null } },
    select: DM_FIELDS,
  });
  if (admins.length === 0) return;

  const url = appUrl("/approvals");
  const text =
    info.kind === "cover"
      ? `🛎️ ${info.taker} is covering for ${info.previousOwner} on ` +
        `${setLabel(info.set)}. Waiting for your approval` +
        (url ? `, review it here: ${url}` : ".")
      : `🛎️ A ${roleLabel(info.role)} swap on ${setLabel(info.set)} ` +
        `is awaiting your approval.` +
        (url ? ` Review it here: ${url}` : "");

  await Promise.all(admins.map((m) => dm.messaging.postDm(m, text)));
}

/**
 * Tell ONE person their own place on a set changed — they were put on it, taken
 * off it, or handed someone else's slot. This is the personal counterpart to
 * notifySetChange: that one talks to the set's group chat (and only once the
 * chat exists and its lead window has opened), which means the person who most
 * needs to know can hear nothing at all. A DM always reaches them.
 *
 * Quiet in the cases where a message would be noise:
 *
 *   • the set has already happened → nothing they can do about it now.
 *   • they haven't linked Slack in this org → postDm no-ops.
 *
 * Note there's deliberately NO group-chat-style lead window here: being added
 * to a set two months out is exactly when you want to hear about it.
 *
 * Best-effort and non-throwing, like every notifier here — a Slack outage must
 * never fail the roster edit that triggered it.
 */
export async function notifyAssignmentChange(
  setId: string,
  userId: string,
  change: {
    kind: "added" | "removed";
    role: Instrument;
    // The team catalog the role key belongs to, so it reads in that team's own
    // words. Omit and roleLabel falls back to the built-in/humanized name.
    catalog?: TeamRoleDef[];
  }
): Promise<void> {
  try {
    const set = await prisma.set.findUnique({
      where: { id: setId },
      select: { label: true, startsAt: true, orgId: true },
    });
    if (!set || set.startsAt < new Date()) return;
    const dm = await orgMessagingContext(set.orgId, "ROSTER_CHANGE");
    if (!dm) return;

    const member = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId, orgId: set.orgId } },
      select: DM_FIELDS,
    });
    if (!member?.slackUserId) return;

    const role = roleLabel(change.role, change.catalog);
    const where = setLabel(set);
    // Deep link: this opens the calendar with THIS set's detail modal already
    // up, rather than dropping someone on today's month to hunt for it.
    const url = appUrl(setLinkPath(setId));
    // Deliberately says nothing about who else was involved. An admin swapping
    // one person for another is NOT a cover — the person who asked for cover is
    // the one who started it — so naming a counterpart here read as if someone
    // had requested something they never did.
    const text =
      change.kind === "added"
        ? `\u{1F3B8} You're on ${dm.messaging.fmt.bold(role)} for ${where}.` +
          (url ? ` Details here: ${url}` : "")
        : `\u{1F44B} You're no longer on ${where}.`;

    await dm.messaging.postDm(member, text);
  } catch (err) {
    console.error("[slack] assignment-change DM failed", err);
  }
}

/**
 * One person's newly-created seat, for the batched notice below.
 */
export type NewSeat = {
  userId: string;
  role: Instrument;
  // The set's id — what makes each line in the DM a link to that set's modal.
  setId: string;
  set: SetLike;
  // The catalog the role key belongs to, so it reads in that team's own words.
  catalog?: TeamRoleDef[];
};

/**
 * Applying a generated plan seats a lot of people across a lot of sets at once.
 * DMing per seat (what notifyAssignmentChange would do) turns one admin click
 * into a dozen pings for the same person, so this batches instead: ONE message
 * each, listing every set they just picked up, oldest first.
 *
 * Same quiet rules as the per-seat DM — past sets are dropped, and anyone
 * without linked Slack in this org is skipped by postDm. Someone
 * left with nothing to report after that filtering gets no message at all.
 *
 * Best-effort and non-throwing: applying the plan must succeed even if Slack
 * is down.
 */
export async function notifyAssignmentsAdded(
  orgId: string,
  seats: NewSeat[]
): Promise<void> {
  try {
    const now = new Date();
    const upcoming = seats.filter((s) => s.set.startsAt >= now);
    if (upcoming.length === 0) return;
    const dm = await orgMessagingContext(orgId, "ROSTER_CHANGE");
    if (!dm) return;

    // Group by person, then order each person's list by date so their message
    // reads as a schedule rather than whatever order the plan happened to be in.
    const byUser = new Map<string, NewSeat[]>();
    for (const seat of upcoming) {
      const list = byUser.get(seat.userId) ?? [];
      list.push(seat);
      byUser.set(seat.userId, list);
    }
    for (const list of byUser.values()) {
      list.sort((a, b) => a.set.startsAt.getTime() - b.set.startsAt.getTime());
    }

    // One query for every recipient's DM details, rather than one per person.
    const members = await prisma.orgMembership.findMany({
      where: { orgId, userId: { in: [...byUser.keys()] }, slackUserId: { not: null } },
      select: { ...DM_FIELDS, userId: true },
    });

    const calendarUrl = appUrl("/calendar");
    await Promise.all(
      members.map((m) => {
        const list = byUser.get(m.userId) ?? [];
        // Each line's set links to its own detail modal, so a five-set message
        // is five ways in rather than one trip to the calendar and a hunt for
        // the right day. A provider without inline links (Discord) renders the
        // label and the URL side by side instead — see MessageFormat.link.
        const lines = list.map((seat) => {
          const when = setLabel(seat.set);
          const link = appUrl(setLinkPath(seat.setId));
          return (
            `\u{2022} ${dm.messaging.fmt.bold(roleLabel(seat.role, seat.catalog))} — ` +
            (link ? dm.messaging.fmt.link(link, when) : when)
          );
        });
        const text =
          `\u{1F3B8} You've been scheduled for ${list.length} ` +
          `set${list.length === 1 ? "" : "s"}:\n${lines.join("\n")}` +
          (calendarUrl ? `\nConfirm here: ${calendarUrl}` : "");
        return dm.messaging.postDm(m, text);
      })
    );
  } catch (err) {
    console.error("[slack] batched assignment DMs failed", err);
  }
}

/**
 * Create (or reuse) a set's PRIVATE Slack channel, invite its team, and post
 * the roster. Backs both the manual "Message Team on Slack" button and the
 * auto group-chat cron. The channel id is persisted on the set so the archive
 * cron can find it later; groupChatCreatedAt is stamped on creation so it's
 * only made once. Reports failures (deliberate action, not fire-and-forget).
 */
export async function messageSetTeamOnSlack(
  setId: string
): Promise<
  // `playlistNote` = why no Spotify playlist link was posted (undefined when one
  // was). Informational only — the group chat itself still succeeded.
  { ok: true; playlistNote?: string } | { ok: false; error: string }
> {
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: {
      label: true,
      startsAt: true,
      orgId: true,
      groupChatChannelId: true,
      // The team's catalog, so the roster reads in this team's own role names
      // and order rather than the built-in ones.
      team: { select: { roles: { orderBy: { order: "asc" } } } },
      assignments: {
        select: { userId: true, role: true, user: { select: { name: true } } },
      },
    },
  });
  if (!set) return { ok: false, error: "Set not found." };

  const messaging = await transportForOrg(set.orgId);
  if (!messaging) {
    return { ok: false, error: "Slack isn't connected for this org yet." };
  }

  // Per-org member ids (workspace-scoped) for everyone who should be in the
  // channel: the set's assigned people, PLUS anyone in the org flagged
  // "alwaysInGroupChats" (e.g. a ministry lead who wants to be in every set's
  // chat, even sets they aren't on). People without a linked Slack are silently
  // excluded (slackUserId filter); duplicates are de-duped.
  const linked = await prisma.orgMembership.findMany({
    where: {
      orgId: set.orgId,
      slackUserId: { not: null },
      OR: [
        { userId: { in: set.assignments.map((a) => a.userId) } },
        { alwaysInGroupChats: true },
      ],
    },
    select: { slackUserId: true },
  });
  const ids = [...new Set(linked.map((m) => m.slackUserId!))];
  if (ids.length === 0) {
    return { ok: false, error: "No one on this set has linked their Slack yet." };
  }

  // Reuse the set's channel if it already has one (a re-click, or the cron
  // after a manual create); otherwise create a fresh private channel and record
  // it so we never make a second one and the archive cron can find it.
  let channelId = set.groupChatChannelId;
  if (!channelId) {
    channelId = await messaging.createGroupChat(channelNameForSet(set));
    if (!channelId) return { ok: false, error: "Could not create the channel." };
    await prisma.set.update({
      where: { id: setId },
      data: { groupChatChannelId: channelId, groupChatCreatedAt: new Date() },
    });
  }

  // Best-effort: invite the team and set the topic. Slack rejects invites for
  // people already in the channel, so neither should block the roster message.
  await messaging.inviteToGroupChat(channelId, ids);
  // A provider whose group chats have no topic (a Discord thread) just skips this.
  if (messaging.capabilities.groupChatTopics) {
    await messaging.setGroupChatTopic(channelId, setTopicName(set));
  }

  const text =
    `🙏 Thanks for serving! Your upcoming set is ${setLabel(set)}.\n\n` +
    `Here's everyone playing in it:\n${teamRosterText(set.assignments, set.team?.roles, messaging.fmt)}`;
  const posted = await messaging.postToChannel(channelId, text);

  // Auto-build the set's collaborative Spotify playlist alongside the group chat
  // and drop its link in the channel. Best-effort and fully decoupled: a Spotify
  // failure never affects the group chat result. It is REPORTED, though —
  // `playlistNote` carries the reason back to the caller and the log, because a
  // silent skip is indistinguishable from the feature being broken.
  let playlistNote: string | undefined;
  try {
    if (!(await isOrgSpotifyConnected(set.orgId))) {
      playlistNote = "Spotify isn't connected for this org.";
    } else {
      const playlist = await createOrSyncSetPlaylist(setId);
      if (playlist.ok) {
        await messaging.postToChannel(
          channelId,
          `🎵 Spotify playlist for this set: ${playlist.url}`
        );
      } else {
        playlistNote = playlist.error;
      }
    }
  } catch (err) {
    console.error("[slack] spotify playlist post failed", err);
    playlistNote = "The Spotify step failed unexpectedly.";
  }
  if (playlistNote) {
    console.warn(`[spotify] no playlist for set ${setId}: ${playlistNote}`);
  }

  return posted
    ? { ok: true, playlistNote }
    : { ok: false, error: "Could not post the message." };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Post a "this set changed" notice into the set's group chat — roster edits and
 * setlist edits both come through here. Deliberately narrow about when it
 * speaks, so a set nobody is thinking about yet stays quiet:
 *
 *   • groupChatLeadDays null ("No Auto GC") → never. Turning the auto chat off
 *     is how you opt a set out of these notices entirely.
 *   • before startsAt − leadDays → too early: that's the window in which the
 *     chat gets created, and there may be no chat (or audience) yet.
 *   • no channel on the set → nothing to post into. The chat is created by the
 *     cron (or the Slack Team button); we never create one just to complain.
 *   • the set has already happened → the channel is being archived; stay quiet.
 *
 * Best-effort and non-throwing: a Slack outage must never fail the db mutation
 * that triggered the notice.
 */
export async function notifySetChange(setId: string, text: string): Promise<void> {
  try {
    const set = await prisma.set.findUnique({
      where: { id: setId },
      select: {
        orgId: true,
        startsAt: true,
        groupChatLeadDays: true,
        groupChatChannelId: true,
      },
    });
    if (!set || set.groupChatLeadDays === null || !set.groupChatChannelId) return;

    const now = new Date();
    const windowStart = new Date(
      set.startsAt.getTime() - set.groupChatLeadDays * DAY_MS
    );
    if (now < windowStart || now > set.startsAt) return;

    const messaging = await transportForOrg(set.orgId);
    if (!messaging) return;
    await messaging.postToChannel(set.groupChatChannelId, text);
  } catch (err) {
    console.error("[slack] set-change notice failed", err);
  }
}

/**
 * Auto group-chat cron worker. For every upcoming set with a per-set lead time
 * that's now inside its window and has no channel yet, create the channel (via
 * messageSetTeamOnSlack, which stamps groupChatCreatedAt so it's only made
 * once). Best-effort and silent: a set with no linked members (or an org
 * without Slack) is left unmarked so a later daily run can retry once people
 * link — and it naturally stops once the set is in the past.
 */
export async function runDueGroupChats(
  now: Date = new Date()
): Promise<{ created: number; considered: number }> {
  const candidates = await prisma.set.findMany({
    where: {
      groupChatLeadDays: { not: null },
      groupChatCreatedAt: null,
      startsAt: { gte: now },
    },
    select: { id: true, startsAt: true, groupChatLeadDays: true },
  });

  let created = 0;
  let considered = 0;
  for (const s of candidates) {
    // Only once we're within `leadDays` of the set's start.
    const windowStart = new Date(s.startsAt.getTime() - s.groupChatLeadDays! * DAY_MS);
    if (now < windowStart) continue;
    considered++;
    const result = await messageSetTeamOnSlack(s.id);
    if (result.ok) created++;
    // Not ok (nobody linked yet, or Slack off): messageSetTeamOnSlack didn't
    // stamp groupChatCreatedAt, so it's retried on the next daily run.
  }
  return { created, considered };
}

/**
 * Auto-archive cron worker. Archive the Slack channel of any set whose event
 * date has fully passed (start before the start of today), stamping
 * `groupChatArchivedAt` so it's only archived once. Runs on the same daily
 * cron, so archiving lands the day after the event rather than at 11:59pm
 * sharp — the closest a once-daily cron can get. Best-effort; a failure is
 * left unmarked to retry next run.
 */
export async function archiveDueGroupChats(
  now: Date = new Date()
): Promise<{ archived: number; considered: number }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const due = await prisma.set.findMany({
    where: {
      groupChatChannelId: { not: null },
      groupChatArchivedAt: null,
      startsAt: { lt: startOfToday },
    },
    select: { id: true, orgId: true, groupChatChannelId: true },
  });

  // Cache one transport per org so a batch of sets in the same org reuses it.
  const messagingByOrg = new Map<string, MessagingTransport | null>();
  let archived = 0;
  for (const s of due) {
    if (!messagingByOrg.has(s.orgId)) {
      messagingByOrg.set(s.orgId, await transportForOrg(s.orgId));
    }
    const messaging = messagingByOrg.get(s.orgId) ?? null;
    if (!messaging) continue;
    if (await messaging.archiveGroupChat(s.groupChatChannelId!)) {
      await prisma.set.update({
        where: { id: s.id },
        data: { groupChatArchivedAt: new Date() },
      });
      archived++;
    }
  }
  return { archived, considered: due.length };
}

// ── Weekly team summary (posted to the team's Slack channel) ───────────────

type SummarySet = {
  label: string | null;
  startsAt: Date;
  mdUserId: string | null; // the set's one designated MD, if any
  assignments: { role: Instrument; user: { id: string; name: string } }[];
};

/**
 * The week-ahead digest for one team, one block per set:
 *
 *   *Sunday Worship* — Sunday, July 12, 2026 · 10:00 AM
 *   • Bob — Keys (MD)
 *   • Alice — Worship Leader
 *
 * People are listed in scarce-first role order; (MD) marks the set's designated
 * musical director. Pure (no I/O) so it's unit-testable.
 */
export function weeklySummaryText(
  teamName: string,
  range: { start: Date; end: Date },
  sets: SummarySet[],
  // The team's role catalog, so the roster lines come out in the order the
  // admin arranged them in (TeamRolesEditor) and under that team's own names.
  // Omitted → the built-in ordering, same as teamRosterText.
  catalog?: TeamRoleDef[],
  // The provider's markup; defaults to Slack's, like teamRosterText.
  fmt: MessageFormat = SLACK_FORMAT
): string {
  const title =
    `📅 ${fmt.bold(teamName)} — sets for ` +
    `${shortDateLabel(range.start)} – ${shortDateLabel(range.end)}`;
  const blocks = sets.map((set) => {
    const header =
      `${fmt.bold(set.label ?? "Worship set")} — ` +
      `${formatDay(set.startsAt)} · ${formatTime(set.startsAt)}`;
    // Sort into the team's display order, keeping the original order within a
    // role. A role the order doesn't mention (one the team has since dropped)
    // sorts last rather than first — indexOf would give it -1.
    const order = catalog?.length
      ? orderedRoles(catalog).map((r) => r.key)
      : ALL_INSTRUMENTS;
    const rank = (role: string) => {
      const i = order.indexOf(role);
      return i === -1 ? order.length : i;
    };
    const lines = [...set.assignments]
      .sort((a, b) => rank(a.role) - rank(b.role))
      .map(
        (a) =>
          `• ${a.user.name} — ${roleLabel(a.role, catalog)}${a.user.id === set.mdUserId ? " (MD)" : ""}`
      );
    if (lines.length === 0) lines.push("• _No one assigned yet_");
    return [header, ...lines].join("\n");
  });
  return [title, ...blocks].join("\n\n");
}

/**
 * Post the next 7 days of a team's sets to its configured Slack channel.
 * Like messageSetTeamOnSlack, this is a deliberate admin action, so it
 * reports failures instead of swallowing them.
 */
export async function sendTeamWeeklySummary(
  teamId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { name: true, slackChannelId: true, orgId: true },
  });
  if (!team) return { ok: false, error: "Team not found." };
  if (!team.slackChannelId) {
    return { ok: false, error: "Set a Slack channel ID for this team first." };
  }

  const messaging = await transportForOrg(team.orgId);
  if (!messaging) {
    return { ok: false, error: "Slack isn't connected for this org yet." };
  }

  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sets = await prisma.set.findMany({
    where: { teamId, startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });
  if (sets.length === 0) {
    return { ok: false, error: "No sets in the next 7 days — nothing sent." };
  }

  const posted = await messaging.postToChannel(
    team.slackChannelId,
    // Read the catalog so the summary lists roles in this team's own order.
    weeklySummaryText(
      team.name,
      { start, end },
      sets,
      await getTeamCatalog(teamId),
      messaging.fmt
    )
  );
  return posted
    ? { ok: true }
    : {
        ok: false,
        error: "Could not post — is the bot invited to that channel?",
      };
}

/**
 * The daily digest run (called by the daily cron). DMs everyone who hasn't
 * already been sent one today, ONE MESSAGE PER ORG they belong to. Skips anyone
 * with nothing to do in that org, anyone opted out, and any org/person without
 * a Slack link.
 *
 * The lastSent guard is per membership and compares against the START of today,
 * so this is safe to call repeatedly — the cron fires once a day, and running it
 * more often just delivers closer to 8 AM rather than duplicating.
 * Best-effort and non-throwing, like every other sender here.
 */
export async function sendDailyDigests(
  now: Date = new Date()
): Promise<{ sent: number; skipped: number }> {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  // Outside the morning window this isn't a digest run — bail without sending.
  // The window is deliberately wider than the 8 AM target: the UTC cron slot
  // shifts an hour against local time across DST, so an exact-time check would
  // (and did) skip the whole winter. See the constants for the full reasoning.
  if (
    minutesNow < DIGEST_WINDOW_START_MINUTE ||
    minutesNow >= DIGEST_WINDOW_END_MINUTE
  ) {
    return { sent: 0, skipped: 0 };
  }

  const due = await prisma.orgMembership.findMany({
    where: {
      slackUserId: { not: null },
      user: { dailyDigest: true },
      OR: [{ digestSentAt: null }, { digestSentAt: { lt: startOfToday } }],
    },
    select: {
      ...DM_FIELDS,
      orgId: true,
      isAdmin: true,
      user: { select: { id: true, name: true } },
      // digestUpcomingDays is the org's own look-ahead window (Org settings) —
      // it decides what the digest counts AND what its copy says.
      org: {
        select: {
          name: true,
          digestUpcomingDays: true,
          notificationPrefs: true,
        },
      },
    },
  });

  let sent = 0;
  let skipped = 0;
  // Transports are per org and most orgs have several members — resolve each
  // once instead of per membership.
  const messagingByOrg = new Map<string, MessagingTransport | null>();

  for (const m of due) {
    try {
      // The org switched the morning summary off for everyone (Org settings →
      // Notifications). Deliberately not stamped as sent, so switching it back
      // on still delivers today's.
      if (
        !notificationEnabled(
          parseNotificationPrefs(m.org.notificationPrefs),
          "DAILY_DIGEST"
        )
      ) {
        skipped++;
        continue;
      }
      if (!messagingByOrg.has(m.orgId)) messagingByOrg.set(m.orgId, await transportForOrg(m.orgId));
      const messaging = messagingByOrg.get(m.orgId) ?? null;
      if (!messaging) {
        skipped++;
        continue;
      }

      const items = await buildOrgDigest(m.user.id, m.orgId, {
        isAdmin: m.isAdmin,
        orgName: m.org.name,
        upcomingDays: m.org.digestUpcomingDays,
        now,
      });
      // Nothing needs them today — stay quiet rather than DM an empty list.
      // Deliberately NOT stamped as sent, so a set added later today can still
      // reach them on a subsequent run.
      if (items.length === 0) {
        skipped++;
        continue;
      }

      const text = renderDigestText(m.user.name, items, appUrl(), messaging.fmt);
      const ok = await messaging.postDm(m, text);
      if (!ok) {
        skipped++;
        continue;
      }
      await prisma.orgMembership.update({
        where: { id: m.id },
        data: { digestSentAt: now },
      });
      sent++;
    } catch (err) {
      // One bad membership must never abort the whole run.
      console.error("[slack] daily digest failed", err);
      skipped++;
    }
  }

  return { sent, skipped };
}
