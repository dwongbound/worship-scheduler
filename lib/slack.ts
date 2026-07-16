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
import { decryptSecret } from "./crypto";
import { INSTRUMENT_LABELS, ROLE_ORDER, type Instrument } from "./constants";
import { formatDay, formatTime, shortDateLabel } from "./dates";

const SLACK_API = "https://slack.com/api";

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
    // Fake the only response field callers read back: the opened channel id.
    return method === "conversations.open" ? { channel: { id: "C_DRY_RUN" } } : {};
  }
  if (!token) return null;
  try {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`[slack] ${method} failed:`, data.error);
      return null;
    }
    return data;
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

/** Open a group DM among several users; returns the channel id for posting. */
export async function openGroupConversation(
  token: string | null,
  slackUserIds: string[]
): Promise<string | null> {
  return openConversation(token, slackUserIds);
}

// MPIMs have no "name" field the way channels do — conversations.rename
// only works on channels. The closest equivalent is the conversation topic,
// which Slack does support setting on an mpim (requires mpim:write.topic).
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

// The MPIM topic doubles as its "name": "<date>-<set name>".
function setTopicName(set: SetLike): string {
  const name = set.label ?? "Worship Set";
  return `${shortDateLabel(set.startsAt)}-${name}`;
}

// "Worship Leader: Alice\nVocals: Bob, Carol\n…" in scarce-first role order,
// skipping roles nobody is filling.
export function teamRosterText(
  assignments: { role: Instrument; user: { name: string } }[]
): string {
  const namesByRole = new Map<Instrument, string[]>();
  for (const a of assignments) {
    const names = namesByRole.get(a.role) ?? [];
    names.push(a.user.name);
    namesByRole.set(a.role, names);
  }
  return ROLE_ORDER.filter((role) => namesByRole.has(role))
    .map((role) => `*${INSTRUMENT_LABELS[role]}:* ${namesByRole.get(role)!.join(", ")}`)
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
    include: { set: { select: { label: true, startsAt: true, orgId: true } } },
  });
  if (!assignment) return;

  const token = await orgBotToken(assignment.set.orgId);
  if (!token && !slackDryRun()) return;

  // Same eligibility rule as GET /api/swaps: plays this role, isn't the
  // requester, is in the set's org, and has linked Slack in THAT org.
  const eligible = await prisma.orgMembership.findMany({
    where: {
      orgId: assignment.set.orgId,
      userId: { not: assignment.userId },
      slackUserId: { not: null },
      user: { instruments: { has: assignment.role } },
    },
    select: { slackUserId: true },
  });

  const url = appUrl("/swaps");
  const text =
    `🎚️ A ${INSTRUMENT_LABELS[assignment.role]} slot on ` +
    `${setLabel(assignment.set)} just opened up for swap.` +
    (url ? ` Take it here: ${url}` : "");

  await Promise.all(
    eligible.map((m) => postDirectMessage(token, m.slackUserId!, text))
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
    select: { slackUserId: true },
  });
  if (!owner?.slackUserId) return;

  const text =
    `✅ ${takerName} took your ${INSTRUMENT_LABELS[assignment.role]} slot on ` +
    `${setLabel(assignment.set)}. You're off the hook!`;
  await postDirectMessage(token, owner.slackUserId, text);
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
}): Promise<void> {
  const token = await orgBotToken(request.orgId);
  if (!token && !slackDryRun()) return;

  const members = await prisma.orgMembership.findMany({
    where: { orgId: request.orgId, slackUserId: { not: null } },
    select: { slackUserId: true },
  });

  const label =
    request.name ??
    `${formatDay(request.startDate)} – ${formatDay(request.endDate)}`;
  const url = appUrl("/schedule");
  const text =
    `📅 Please enter your availability for *${label}*.` +
    (url ? ` ${url}` : "");

  await Promise.all(
    members.map((m) => postDirectMessage(token, m.slackUserId!, text))
  );
}

/**
 * Open a group DM among a set's assigned team members, name it after the set,
 * and post the team roster. Returns a small result the admin route can
 * surface to the UI. (Unlike the notify* helpers this reports failures,
 * since it's a deliberate user action rather than a fire-and-forget side
 * effect.)
 */
export async function messageSetTeamOnSlack(
  setId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: {
      label: true,
      startsAt: true,
      orgId: true,
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

  // Per-org member ids for the assigned people (member ids are workspace-scoped).
  const linked = await prisma.orgMembership.findMany({
    where: {
      orgId: set.orgId,
      slackUserId: { not: null },
      userId: { in: set.assignments.map((a) => a.userId) },
    },
    select: { slackUserId: true },
  });
  const ids = linked.map((m) => m.slackUserId!);
  if (ids.length === 0) {
    return { ok: false, error: "No one on this set has linked their Slack yet." };
  }

  const channelId = await openGroupConversation(token, ids);
  if (!channelId) return { ok: false, error: "Could not open the group chat." };

  // Best-effort: some workspace configs restrict topic writes on mpims, but
  // that shouldn't stop the roster message from going out.
  await setConversationTopic(token, channelId, setTopicName(set));

  const text =
    `🙏 Thanks for serving! Your upcoming set is ${setLabel(set)}.\n\n` +
    `Here's everyone playing in it:\n${teamRosterText(set.assignments)}`;
  const posted = await postToChannel(token, channelId, text);
  return posted
    ? { ok: true }
    : { ok: false, error: "Could not post the message." };
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
    // Sort into ROLE_ORDER, keeping the original order within a role.
    const lines = [...set.assignments]
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map(
        (a) =>
          `• ${a.user.name} — ${INSTRUMENT_LABELS[a.role]}${a.user.id === set.mdUserId ? " (MD)" : ""}`
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
