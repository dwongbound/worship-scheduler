// Slack integration: a thin, non-throwing wrapper over the Slack Web API plus
// the high-level notification helpers the app calls after schedule changes.
//
// Two hard rules keep this safe to sprinkle through the mutation routes:
//   1. Everything no-ops when the org hasn't connected Slack (no bot token),
//      so the app runs identically without Slack configured (dev/test/CI).
//   2. Nothing throws — a Slack outage must never break a db mutation. Failures
//      are logged and swallowed; helpers return false/null instead.
//
// This module is server-only (it imports prisma). The client talks to it via
// the API routes, never by importing it directly.
import { prisma } from "./prisma";
import { orderedRoles, roleLabel, type TeamRoleDef } from "./teamRoles";
import type { Prisma } from "./generated/prisma/client";
import { decryptSecret } from "./crypto";
import { createOrSyncSetPlaylist, isOrgSpotifyConnected } from "./spotify";
import {
  ALL_INSTRUMENTS,
  DIGEST_WINDOW_END_MINUTE,
  DIGEST_WINDOW_START_MINUTE,
  INSTRUMENT_LABELS,
  type Instrument,
} from "./constants";
import { buildOrgDigest, renderDigestText } from "./digest";
import { formatDay, formatTime, shortDateLabel } from "./dates";
import { isUserAvailable, type UnavailabilityRule } from "./scheduler";
import { createRateLimiter } from "./rateLimit";

const SLACK_API = "https://slack.com/api";

// Minimum gap between two Slack calls. Deliberately modest: it exists to stop a
// `Promise.all` fan-out from arriving as one burst, which is what actually
// provokes a 429. The real guarantee is the Retry-After handling below. A full
// second here would be "safer" per Slack's slowest documented tier and would
// also make a 100-person digest outlive the cron's time budget.
// Zero under vitest: the unit tests exercise slackApi against a mocked fetch,
// and real pacing there just makes the suite slow without testing anything —
// the limiter has its own tests in tests/unit/rateLimit.test.ts.
const SLACK_MIN_INTERVAL_MS = process.env.NODE_ENV === "test" ? 0 : 100;

// How long to respect a 429 that arrives without a usable Retry-After header,
// and the ceiling on one that asks for an implausibly long wait (we'd rather
// drop the message and retry on the next run than hold the function open).
const RETRY_AFTER_FALLBACK_MS = 1000;
const RETRY_AFTER_MAX_MS = 30_000;

// ONE limiter for the whole module, so every path — digests, swap DMs,
// availability blasts, group chats — shares a single queue rather than each
// fan-out pacing itself in ignorance of the others.
const slackLimit = createRateLimiter(SLACK_MIN_INTERVAL_MS);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether an org can currently send Slack messages: its bot is installed, or
 * we're in dry-run mode. Slack is per-org now, so this is always org-scoped —
 * the UI uses it to show/hide that org's Slack actions.
 */
export async function isOrgSlackConnected(orgId: string): Promise<boolean> {
  if (slackDryRun()) return true;
  return (await orgBotToken(orgId)) !== null;
}

/**
 * The decrypted bot token for one org's Slack workspace, or null if that org
 * hasn't connected Slack. Tokens are per-workspace (Flow B install), so DMs to
 * org A must use A's token — never a shared/env token, which would post into
 * the wrong workspace.
 */
async function orgBotToken(orgId: string): Promise<string | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { slackBotToken: true },
  });
  if (!org?.slackBotToken) return null;
  try {
    return decryptSecret(org.slackBotToken);
  } catch {
    return null; // key rotated or corrupt — treat as not connected
  }
}

// Dry-run mode (SLACK_DRY_RUN=1): run every Slack code path — queries,
// eligibility filtering, message building — but log the would-be API calls
// instead of sending them. No chats get opened, nobody gets messaged. Works
// even without a token, so dev instances can test with zero risk.
function slackDryRun(): boolean {
  return process.env.SLACK_DRY_RUN === "1" || process.env.SLACK_DRY_RUN === "true";
}

// Low-level POST to one Slack Web API method. Returns the parsed JSON on success
// (Slack sets `ok: true`) or null on any failure. Never throws.
async function slackApi(
  method: string,
  body: Record<string, unknown>,
  token: string | null
): Promise<Record<string, any> | null> {
  if (slackDryRun()) {
    console.log(`[slack] DRY RUN ${method}:`, JSON.stringify(body));
    // Fake the only response field callers read back: the channel id from
    // opening a DM or creating a channel.
    return method === "conversations.open" || method === "conversations.create"
      ? { channel: { id: "C_DRY_RUN" } }
      : {};
  }
  if (!token) return null;

  // Queued behind every other Slack call in this process. `attempt` runs once
  // normally and once more after a rate-limited backoff.
  const attempt = async (): Promise<
    { data: Record<string, any> | null } | { retryAfterMs: number }
  > => {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    // Slack signals rate limiting with a 429 + Retry-After (in seconds). It
    // also sets error:"ratelimited" in the body, which is what this code used
    // to swallow as an ordinary failure — silently dropping the message.
    if (res.status === 429) {
      const header = Number(res.headers.get("retry-after"));
      const waitMs =
        Number.isFinite(header) && header > 0
          ? header * 1000
          : RETRY_AFTER_FALLBACK_MS;
      return { retryAfterMs: Math.min(waitMs, RETRY_AFTER_MAX_MS) };
    }
    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack] ${method} failed:`, data.error);
      return { data: null };
    }
    return { data };
  };

  try {
    // The backoff sleeps INSIDE the queue slot on purpose: when Slack says slow
    // down, everything waiting behind us should slow down too, not pile on.
    const first = await slackLimit(async () => {
      const result = await attempt();
      if (!("retryAfterMs" in result)) return result;
      console.warn(
        `[slack] ${method} rate limited — retrying in ${result.retryAfterMs}ms`
      );
      await sleep(result.retryAfterMs);
      return attempt();
    });
    if ("retryAfterMs" in first) {
      // Still limited after one retry — give up and let the caller's own retry
      // path (the next cron run, usually) handle it.
      console.error(`[slack] ${method} still rate limited after retry`);
      return null;
    }
    return first.data;
  } catch (err) {
    console.error(`[slack] ${method} threw:`, err);
    return null;
  }
}

// Open (or reuse) a conversation with one or more users and return its channel
// id. One user → a DM channel; several → a group DM (MPIM).
async function openConversation(
  token: string | null,
  slackUserIds: string[]
): Promise<string | null> {
  if (slackUserIds.length === 0) return null;
  const data = await slackApi(
    "conversations.open",
    { users: slackUserIds.join(",") },
    token
  );
  return (data?.channel?.id as string | undefined) ?? null;
}

/** Post a message to an already-known channel id, using an org's bot token. */
export async function postToChannel(
  token: string | null,
  channelId: string,
  text: string
): Promise<boolean> {
  return !!(await slackApi("chat.postMessage", { channel: channelId, text }, token));
}

/** DM a single user by their Slack member id (U...) in one org's workspace. */
export async function postDirectMessage(
  token: string | null,
  slackUserId: string,
  text: string
): Promise<boolean> {
  const channelId = await openConversation(token, [slackUserId]);
  if (!channelId) return false;
  return postToChannel(token, channelId, text);
}

// The membership fields every cached DM needs. Select these wherever you're
// about to message people (see DM_FIELDS below for the Prisma `select`).
export type DmTarget = {
  id: string;
  slackUserId: string | null;
  slackDmChannelId: string | null;
};

/** The `select` that produces a DmTarget — kept next to the type so they can't drift. */
export const DM_FIELDS = {
  id: true,
  slackUserId: true,
  slackDmChannelId: true,
} as const;

/**
 * DM one membership, reusing its cached DM channel id.
 *
 * A (bot, user) DM channel is permanent, so `conversations.open` only needs to
 * happen once per person per org — after that it's one API call per message
 * instead of two. That halves the digest's Slack traffic, which is the run most
 * at risk of hitting both the rate limiter and the function time budget.
 *
 * Self-healing: if posting to a CACHED channel fails (the workspace removed the
 * user, the id went stale), the cache is cleared so the next send re-opens it.
 */
export async function postDirectMessageTo(
  token: string | null,
  member: DmTarget,
  text: string
): Promise<boolean> {
  const cached = member.slackDmChannelId;
  let channelId = cached;

  if (!channelId) {
    if (!member.slackUserId) return false;
    channelId = await openConversation(token, [member.slackUserId]);
    if (!channelId) return false;
    // Best-effort: a failed cache write costs an extra open next time, nothing
    // more, so it must never take the message down with it.
    await prisma.orgMembership
      .update({
        where: { id: member.id },
        data: { slackDmChannelId: channelId },
      })
      .catch(() => {});
  }

  const posted = await postToChannel(token, channelId, text);
  if (!posted && cached) {
    await prisma.orgMembership
      .update({ where: { id: member.id }, data: { slackDmChannelId: null } })
      .catch(() => {});
  }
  return posted;
}

// Create a PRIVATE channel and return its id. Channel names must be lowercase
// and unique in the workspace (archived channels keep theirs), so on a name
// clash we retry with a counted "-2"/"-3" suffix — people read these names, so
// a readable tiebreaker beats a random hash. Needs groups:write (added at
// install).
export async function createPrivateChannel(
  token: string | null,
  name: string
): Promise<string | null> {
  for (const candidate of [name, `${name}-2`, `${name}-3`]) {
    const data = await slackApi(
      "conversations.create",
      { name: candidate, is_private: true },
      token
    );
    const id = data?.channel?.id as string | undefined;
    if (id) return id;
  }
  return null;
}

// Invite users to a channel. Best-effort: Slack rejects the whole call if any
// user is already in the channel (re-invite) or can't be added, so a failure
// here shouldn't stop the roster message from going out.
export async function inviteToChannel(
  token: string | null,
  channelId: string,
  slackUserIds: string[]
): Promise<void> {
  if (slackUserIds.length === 0) return;
  await slackApi(
    "conversations.invite",
    { channel: channelId, users: slackUserIds.join(",") },
    token
  );
}

/** Archive a channel (used once a set's event date has passed). */
export async function archiveChannel(
  token: string | null,
  channelId: string
): Promise<boolean> {
  return !!(await slackApi("conversations.archive", { channel: channelId }, token));
}

// The channel topic doubles as a human label: "<date>-<set name>".
export async function setConversationTopic(
  token: string | null,
  channelId: string,
  topic: string
): Promise<boolean> {
  return !!(await slackApi("conversations.setTopic", { channel: channelId, topic }, token));
}

/**
 * Resolve a user's member id in an org's workspace by their email
 * (users.lookupByEmail). Lets us auto-populate OrgMembership.slackUserId at
 * install time so most people never click "Connect". Returns null on any miss.
 */
async function lookupMemberByEmail(
  token: string | null,
  email: string
): Promise<string | null> {
  const data = await slackApi("users.lookupByEmail", { email }, token);
  return (data?.user?.id as string | undefined) ?? null;
}

/**
 * Best-effort: for every member of an org that has no slackUserId yet, try to
 * resolve it by email and cache it on their OrgMembership. Called after a bot
 * install. Never throws.
 */
export async function autoPopulateSlackIds(orgId: string): Promise<void> {
  const token = await orgBotToken(orgId);
  if (!token && !slackDryRun()) return;
  const rows = await prisma.orgMembership.findMany({
    where: { orgId, slackUserId: null, user: { email: { not: null } } },
    select: { id: true, user: { select: { email: true } } },
  });
  for (const row of rows) {
    const id = await lookupMemberByEmail(token, row.user.email!);
    if (!id) continue;
    // The (orgId, slackUserId) unique guard can trip if two app accounts share
    // a Slack id — skip silently rather than fail the whole install.
    await prisma.orgMembership
      .update({ where: { id: row.id }, data: { slackUserId: id } })
      .catch(() => {});
  }
}

// ── Message-text helpers ──────────────────────────────────────────────────

type SetLike = { label: string | null; startsAt: Date };

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
  catalog?: TeamRoleDef[]
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
    .map((role) => `*${roleLabel(role, catalog)}:* ${namesByRole.get(role)!.join(", ")}`)
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

  const token = await orgBotToken(assignment.set.orgId);
  if (!token && !slackDryRun()) return;

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

  const url = appUrl("/swaps");
  const text =
    `🎚️ A ${roleLabel(assignment.role)} slot on ` +
    `${setLabel(assignment.set)} just opened up for swap.` +
    (url ? ` Take it here: ${url}` : "");

  // Queued through the shared rate limiter (lib/rateLimit), so this fans out in
  // call order at a safe pace rather than as one burst.
  await Promise.all(
    available.map((m) => postDirectMessageTo(token, m, text))
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

  const token = await orgBotToken(assignment.set.orgId);
  if (!token && !slackDryRun()) return;

  const owner = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: previousOwnerId, orgId: assignment.set.orgId } },
    select: DM_FIELDS,
  });
  if (!owner?.slackUserId) return;

  const text =
    `✅ ${takerName} took your ${roleLabel(assignment.role)} slot on ` +
    `${setLabel(assignment.set)}. You're off the hook!`;
  await postDirectMessageTo(token, owner, text);
}

// A proposal's two sets + the org they share, plus each party's per-org Slack
// id. Shared by the targeted-swap notifications below.
async function loadProposalSlack(proposalId: string) {
  const p = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    include: {
      requestedBy: { select: { id: true, name: true } },
      fromAssignment: {
        select: {
          role: true,
          set: { select: { label: true, startsAt: true, orgId: true } },
        },
      },
      toAssignment: {
        select: {
          userId: true,
          user: { select: { name: true } },
          set: { select: { label: true, startsAt: true } },
        },
      },
    },
  });
  if (!p) return null;
  const orgId = p.fromAssignment.set.orgId;
  const token = await orgBotToken(orgId);
  if (!token && !slackDryRun()) return null;
  // Per-org Slack ids for the two parties.
  const memberships = await prisma.orgMembership.findMany({
    where: { orgId, userId: { in: [p.requestedById, p.toAssignment.userId] } },
    select: { ...DM_FIELDS, userId: true },
  });
  // The membership row (not just the Slack id) so DMs can use the cached channel.
  const memberFor = (userId: string) =>
    memberships.find((m) => m.userId === userId && m.slackUserId) ?? null;
  return { p, token, memberFor };
}

/**
 * A targeted swap was proposed. DM the recipient (who'd give up their slot) so
 * they can accept or reject it. No-op if they haven't linked Slack.
 */
export async function notifySwapProposed(proposalId: string): Promise<void> {
  const loaded = await loadProposalSlack(proposalId);
  if (!loaded) return;
  const { p, token, memberFor } = loaded;
  const member = memberFor(p.toAssignment.userId);
  if (!member) return;

  const url = appUrl("/swaps");
  const text =
    `🔁 ${p.requestedBy.name} wants to swap their ` +
    `${roleLabel(p.fromAssignment.role)} slot on ` +
    `${setLabel(p.fromAssignment.set)} for yours on ` +
    `${setLabel(p.toAssignment.set)}.` +
    (url ? ` Accept or decline here: ${url}` : "");
  await postDirectMessageTo(token, member, text);
}

/**
 * A targeted swap was accepted or rejected. DM the requester with the outcome.
 * No-op if they haven't linked Slack.
 */
export async function notifySwapResolved(
  proposalId: string,
  accepted: boolean
): Promise<void> {
  const loaded = await loadProposalSlack(proposalId);
  if (!loaded) return;
  const { p, token, memberFor } = loaded;
  const member = memberFor(p.requestedById);
  if (!member) return;

  const who = p.toAssignment.user.name;
  const text = accepted
    ? `✅ ${who} accepted your swap — you're now on ` +
      `${setLabel(p.toAssignment.set)} and they've got ` +
      `${setLabel(p.fromAssignment.set)}.`
    : `🚫 ${who} declined your swap for ` +
      `${setLabel(p.fromAssignment.set)}. Your slot is unchanged.`;
  await postDirectMessageTo(token, member, text);
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
  const token = await orgBotToken(request.orgId);
  if (!token && !slackDryRun()) return;

  const teamIds = request.teams.map((t) => t.id);
  const members = await prisma.orgMembership.findMany({
    where: {
      orgId: request.orgId,
      slackUserId: { not: null },
      // Only members of a targeted team — team membership alone, no roles needed.
      ...(teamIds.length
        ? { user: { teamMembers: { some: { teamId: { in: teamIds } } } } }
        : {}),
    },
    select: DM_FIELDS,
  });

  const label =
    request.name ??
    `${formatDay(request.startDate)} – ${formatDay(request.endDate)}`;
  const url = appUrl("/schedule");
  const text =
    `📅 Please enter your availability for *${label}*.` +
    (url ? ` ${url}` : "");

  await Promise.all(members.map((m) => postDirectMessageTo(token, m, text)));
}

/**
 * A cover-take or accepted swap just entered PENDING_APPROVAL. DM every admin
 * of the set's org (with linked Slack) so they know something's waiting on the
 * Approvals tab. Fire-and-forget; no-op without Slack.
 */
export async function notifyAdminsPendingApproval(
  orgId: string,
  info: { kind: "cover" | "swap"; role: Instrument; set: SetLike }
): Promise<void> {
  const token = await orgBotToken(orgId);
  if (!token && !slackDryRun()) return;

  const admins = await prisma.orgMembership.findMany({
    where: { orgId, isAdmin: true, slackUserId: { not: null } },
    select: DM_FIELDS,
  });
  if (admins.length === 0) return;

  const url = appUrl("/approvals");
  const what = info.kind === "cover" ? "cover" : "swap";
  const text =
    `🛎️ A ${roleLabel(info.role)} ${what} on ${setLabel(info.set)} ` +
    `is awaiting your approval.` +
    (url ? ` Review it here: ${url}` : "");

  await Promise.all(admins.map((m) => postDirectMessageTo(token, m, text)));
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

  const token = await orgBotToken(set.orgId);
  if (!token && !slackDryRun()) {
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
    channelId = await createPrivateChannel(token, channelNameForSet(set));
    if (!channelId) return { ok: false, error: "Could not create the channel." };
    await prisma.set.update({
      where: { id: setId },
      data: { groupChatChannelId: channelId, groupChatCreatedAt: new Date() },
    });
  }

  // Best-effort: invite the team and set the topic. Slack rejects invites for
  // people already in the channel, so neither should block the roster message.
  await inviteToChannel(token, channelId, ids);
  await setConversationTopic(token, channelId, setTopicName(set));

  const text =
    `🙏 Thanks for serving! Your upcoming set is ${setLabel(set)}.\n\n` +
    `Here's everyone playing in it:\n${teamRosterText(set.assignments, set.team?.roles)}`;
  const posted = await postToChannel(token, channelId, text);

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
        await postToChannel(
          token,
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

    const token = await orgBotToken(set.orgId);
    if (!token && !slackDryRun()) return;
    await postToChannel(token, set.groupChatChannelId, text);
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

  // Cache one token per org so a batch of sets in the same org reuses it.
  const tokenByOrg = new Map<string, string | null>();
  let archived = 0;
  for (const s of due) {
    if (!tokenByOrg.has(s.orgId)) {
      tokenByOrg.set(s.orgId, await orgBotToken(s.orgId));
    }
    const token = tokenByOrg.get(s.orgId) ?? null;
    if (!token && !slackDryRun()) continue;
    if (await archiveChannel(token, s.groupChatChannelId!)) {
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
  sets: SummarySet[]
): string {
  const title =
    `📅 *${teamName}* — sets for ` +
    `${shortDateLabel(range.start)} – ${shortDateLabel(range.end)}`;
  const blocks = sets.map((set) => {
    const header = `*${set.label ?? "Worship set"}* — ${formatDay(set.startsAt)} · ${formatTime(set.startsAt)}`;
    // Sort into display order, keeping the original order within a role.
    // Built-in display order, with anything custom after it (indexOf gives -1
    // for a role that isn't built in, which would otherwise sort it first).
    const rank = (role: string) => {
      const i = ALL_INSTRUMENTS.indexOf(role);
      return i === -1 ? ALL_INSTRUMENTS.length : i;
    };
    const lines = [...set.assignments]
      .sort((a, b) => rank(a.role) - rank(b.role))
      .map(
        (a) =>
          `• ${a.user.name} — ${roleLabel(a.role)}${a.user.id === set.mdUserId ? " (MD)" : ""}`
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

  const token = await orgBotToken(team.orgId);
  if (!token && !slackDryRun()) {
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

  const posted = await postToChannel(
    token,
    team.slackChannelId,
    weeklySummaryText(team.name, { start, end }, sets)
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
      org: { select: { name: true, digestUpcomingDays: true } },
    },
  });

  let sent = 0;
  let skipped = 0;
  // Bot tokens are per org and most orgs have several members — resolve each
  // token once instead of per membership.
  const tokens = new Map<string, string | null>();

  for (const m of due) {
    try {
      if (!tokens.has(m.orgId)) tokens.set(m.orgId, await orgBotToken(m.orgId));
      const token = tokens.get(m.orgId) ?? null;
      if (!token && !slackDryRun()) {
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

      const text = renderDigestText(m.user.name, items, appUrl());
      const ok = await postDirectMessageTo(token, m, text);
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
