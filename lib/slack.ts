// Slack integration: a thin, non-throwing wrapper over the Slack Web API plus
// the high-level notification helpers the app calls after schedule changes.
//
// Two hard rules keep this safe to sprinkle through the mutation routes:
//   1. Everything no-ops when SLACK_BOT_TOKEN is unset, so the app runs
//      identically without Slack configured (dev/test/CI need no keys).
//   2. Nothing throws — a Slack outage must never break a db mutation. Failures
//      are logged and swallowed; helpers return false/null instead.
//
// This module is server-only (it imports prisma). The client talks to it via
// the API routes, never by importing it directly.
import { prisma } from "./prisma";
import { INSTRUMENT_LABELS, ROLE_ORDER, type Instrument } from "./constants";
import { formatDay, formatTime, shortDateLabel } from "./dates";

const SLACK_API = "https://slack.com/api";

/** True when the bot token is configured; gates every Slack feature. */
export function slackEnabled(): boolean {
  return !!process.env.SLACK_BOT_TOKEN || slackDryRun();
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
  body: Record<string, unknown>
): Promise<Record<string, any> | null> {
  if (slackDryRun()) {
    console.log(`[slack] DRY RUN ${method}:`, JSON.stringify(body));
    // Fake the only response field callers read back: the opened channel id.
    return method === "conversations.open" ? { channel: { id: "C_DRY_RUN" } } : {};
  }
  const token = process.env.SLACK_BOT_TOKEN;
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
async function openConversation(slackUserIds: string[]): Promise<string | null> {
  if (slackUserIds.length === 0) return null;
  const data = await slackApi("conversations.open", {
    users: slackUserIds.join(","),
  });
  return (data?.channel?.id as string | undefined) ?? null;
}

/** Post a message to an already-known channel id. */
export async function postToChannel(
  channelId: string,
  text: string
): Promise<boolean> {
  return !!(await slackApi("chat.postMessage", { channel: channelId, text }));
}

/** DM a single user by their Slack member id (U...). */
export async function postDirectMessage(
  slackUserId: string,
  text: string
): Promise<boolean> {
  const channelId = await openConversation([slackUserId]);
  if (!channelId) return false;
  return postToChannel(channelId, text);
}

/** Open a group DM among several users; returns the channel id for posting. */
export async function openGroupConversation(
  slackUserIds: string[]
): Promise<string | null> {
  return openConversation(slackUserIds);
}

// MPIMs have no "name" field the way channels do — conversations.rename
// only works on channels. The closest equivalent is the conversation topic,
// which Slack does support setting on an mpim (requires mpim:write.topic).
export async function setConversationTopic(
  channelId: string,
  topic: string
): Promise<boolean> {
  return !!(await slackApi("conversations.setTopic", {
    channel: channelId,
    topic,
  }));
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
  if (!slackEnabled()) return;

  const assignment = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: { set: { select: { label: true, startsAt: true, orgId: true } } },
  });
  if (!assignment) return;

  // Same eligibility rule as GET /api/swaps: plays this role, isn't the
  // requester, belongs to the set's org, and — here — has linked Slack.
  const eligible = await prisma.user.findMany({
    where: {
      id: { not: assignment.userId },
      instruments: { has: assignment.role },
      slackUserId: { not: null },
      memberships: { some: { orgId: assignment.set.orgId } },
    },
    select: { slackUserId: true },
  });

  const url = appUrl("/swaps");
  const text =
    `🎚️ A ${INSTRUMENT_LABELS[assignment.role]} slot on ` +
    `${setLabel(assignment.set)} just opened up for swap.` +
    (url ? ` Take it here: ${url}` : "");

  await Promise.all(
    eligible.map((u) => postDirectMessage(u.slackUserId!, text))
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
  if (!slackEnabled()) return;

  const [assignment, owner] = await Promise.all([
    prisma.assignment.findUnique({
      where: { id: assignmentId },
      include: { set: { select: { label: true, startsAt: true } } },
    }),
    prisma.user.findUnique({
      where: { id: previousOwnerId },
      select: { slackUserId: true },
    }),
  ]);
  if (!assignment || !owner?.slackUserId) return;

  const text =
    `✅ ${takerName} took your ${INSTRUMENT_LABELS[assignment.role]} slot on ` +
    `${setLabel(assignment.set)}. You're off the hook!`;
  await postDirectMessage(owner.slackUserId, text);
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
  if (!slackEnabled()) return;

  const users = await prisma.user.findMany({
    where: {
      slackUserId: { not: null },
      memberships: { some: { orgId: request.orgId } },
    },
    select: { slackUserId: true },
  });

  const label =
    request.name ??
    `${formatDay(request.startDate)} – ${formatDay(request.endDate)}`;
  const url = appUrl("/schedule");
  const text =
    `📅 Please enter your availability for *${label}*.` +
    (url ? ` ${url}` : "");

  await Promise.all(users.map((u) => postDirectMessage(u.slackUserId!, text)));
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
  if (!slackEnabled()) return { ok: false, error: "Slack is not configured." };

  const set = await prisma.set.findUnique({
    where: { id: setId },
    include: {
      assignments: {
        include: { user: { select: { name: true, slackUserId: true } } },
      },
    },
  });
  if (!set) return { ok: false, error: "Set not found." };

  const ids = set.assignments
    .map((a) => a.user.slackUserId)
    .filter((id): id is string => !!id);
  if (ids.length === 0) {
    return { ok: false, error: "No one on this set has linked their Slack yet." };
  }

  const channelId = await openGroupConversation(ids);
  if (!channelId) return { ok: false, error: "Could not open the group chat." };

  // Best-effort: some workspace configs restrict topic writes on mpims, but
  // that shouldn't stop the roster message from going out.
  await setConversationTopic(channelId, setTopicName(set));

  const text =
    `🙏 Thanks for serving! Your upcoming set is ${setLabel(set)}.\n\n` +
    `Here's everyone playing in it:\n${teamRosterText(set.assignments)}`;
  const posted = await postToChannel(channelId, text);
  return posted
    ? { ok: true }
    : { ok: false, error: "Could not post the message." };
}

// ── Weekly team summary (posted to the team's Slack channel) ───────────────

type SummarySet = {
  label: string | null;
  startsAt: Date;
  assignments: { role: Instrument; user: { name: string; isMD: boolean } }[];
};

/**
 * The week-ahead digest for one team, one block per set:
 *
 *   *Sunday Worship* — Sunday, July 12, 2026 · 10:00 AM
 *   • Alice — Worship Leader (MD)
 *   • Bob — Drums
 *
 * People are listed in scarce-first role order; (MD) marks musical directors.
 * Pure (no I/O) so it's unit-testable.
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
          `• ${a.user.name} — ${INSTRUMENT_LABELS[a.role]}${a.user.isMD ? " (MD)" : ""}`
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
  if (!slackEnabled()) return { ok: false, error: "Slack is not configured." };

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { name: true, slackChannelId: true },
  });
  if (!team) return { ok: false, error: "Team not found." };
  if (!team.slackChannelId) {
    return { ok: false, error: "Set a Slack channel ID for this team first." };
  }

  const start = new Date();
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const sets = await prisma.set.findMany({
    where: { teamId, startsAt: { gte: start, lt: end } },
    orderBy: { startsAt: "asc" },
    include: {
      assignments: {
        include: { user: { select: { name: true, isMD: true } } },
      },
    },
  });
  if (sets.length === 0) {
    return { ok: false, error: "No sets in the next 7 days — nothing sent." };
  }

  const posted = await postToChannel(
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
