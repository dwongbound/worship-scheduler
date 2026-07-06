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
import { INSTRUMENT_LABELS } from "./constants";
import { formatDay, formatTime } from "./dates";

const SLACK_API = "https://slack.com/api";

/** True when the bot token is configured; gates every Slack feature. */
export function slackEnabled(): boolean {
  return !!process.env.SLACK_BOT_TOKEN;
}

// Low-level POST to one Slack Web API method. Returns the parsed JSON on success
// (Slack sets `ok: true`) or null on any failure. Never throws.
async function slackApi(
  method: string,
  body: Record<string, unknown>
): Promise<Record<string, any> | null> {
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

// ── Message-text helpers ──────────────────────────────────────────────────

type SetLike = { label: string | null; startsAt: Date };

function setLabel(set: SetLike): string {
  const name = set.label ?? "the worship set";
  return `${name} on ${formatDay(set.startsAt)} at ${formatTime(set.startsAt)}`;
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
    include: { set: { select: { label: true, startsAt: true } } },
  });
  if (!assignment) return;

  // Same eligibility rule as GET /api/swaps: plays this role, isn't the
  // requester, and — here — has linked Slack.
  const eligible = await prisma.user.findMany({
    where: {
      id: { not: assignment.userId },
      instruments: { has: assignment.role },
      slackUserId: { not: null },
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
 * An admin opened a new availability request. DM every user with linked Slack
 * asking them to fill it in.
 */
export async function notifyAvailabilityRequest(request: {
  name: string | null;
  startDate: Date;
  endDate: Date;
}): Promise<void> {
  if (!slackEnabled()) return;

  const users = await prisma.user.findMany({
    where: { slackUserId: { not: null } },
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
 * Open a group DM among a set's assigned team members and post an intro
 * message. Returns a small result the admin route can surface to the UI.
 * (Unlike the notify* helpers this reports failures, since it's a deliberate
 * user action rather than a fire-and-forget side effect.)
 */
export async function messageSetTeamOnSlack(
  setId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!slackEnabled()) return { ok: false, error: "Slack is not configured." };

  const set = await prisma.set.findUnique({
    where: { id: setId },
    include: {
      assignments: {
        include: { user: { select: { slackUserId: true } } },
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

  const text = `👋 Team chat for ${setLabel(set)} — use this to coordinate!`;
  const posted = await postToChannel(channelId, text);
  return posted
    ? { ok: true }
    : { ok: false, error: "Could not post the message." };
}
