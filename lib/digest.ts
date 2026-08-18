// The daily digest: one Slack DM per person per org, at DIGEST_SEND_MINUTE
// (8 AM), listing only the things that actually need them — availability to
// fill in, sets today, spots to confirm, plus the admin approval queues. Each
// bullet links straight to the tab that resolves it.
//
// Split in two on purpose:
//   • buildOrgDigest()  — reads the db, returns plain DigestItems.
//   • renderDigestText() — pure string formatting, unit-tested.
// The sender lives in lib/slack.ts (sendDailyDigests) with the other DM paths.
//
// Scoped PER ORG because everything it reports is per-org: admin rights,
// Slack member ids, and the bot token the DM is sent with. Someone in two orgs
// gets two DMs, each about that org.
import { prisma } from "./prisma";
import { targetsUser } from "./availabilityTargets";
import { DIGEST_UPCOMING_DAYS } from "./constants";
import { formatTime, shortRangeLabel } from "./dates";

/** One bullet: a sentence plus the app path it links to. */
export type DigestItem = {
  text: string;
  /** App-relative path, e.g. "/calendar". */
  path: string;
};

/**
 * Everything in `orgId` that wants this user's attention right now. Returns
 * [] when they're all clear — the caller skips the DM entirely rather than
 * sending "nothing to do".
 *
 * `now` is injected so the cron and tests can pin it.
 */
export async function buildOrgDigest(
  userId: string,
  orgId: string,
  opts: { isAdmin: boolean; orgName: string; now: Date }
): Promise<DigestItem[]> {
  const { isAdmin, orgName, now } = opts;
  const items: DigestItem[] = [];

  // The digest always describes the day it's sent on. (The send time is fixed
  // at 8 AM, so "today" is never ambiguous the way an evening send would be.)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // 1. Availability — the org's active (most recent) request that targets this
  //    person, if they still owe it a response. Mirrors availabilityStatus()
  //    in lib/notifications.ts, scoped to one org.
  const request = await prisma.availabilityRequest.findFirst({
    where: { orgId, ...targetsUser(userId) },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  if (request) {
    const response = await prisma.availabilityResponse.findUnique({
      where: { userId_requestId: { userId, requestId: request.id } },
      select: { completedAt: true },
    });
    if (!response?.completedAt) {
      const label =
        request.name ?? shortRangeLabel(request.startDate, request.endDate);
      items.push({
        text: `Fill out the availability request “${label}” for ${orgName}`,
        path: "/schedule",
      });
    }
  }

  // 2. Sets today — what they're actually playing on, with times.
  const today = await prisma.assignment.findMany({
    where: {
      userId,
      set: { orgId, startsAt: { gte: dayStart, lt: dayEnd } },
    },
    select: { set: { select: { id: true, label: true, startsAt: true } } },
    orderBy: { set: { startsAt: "asc" } },
  });
  // One person can hold several roles on a set — collapse to distinct sets so
  // a guitarist who also leads doesn't read as two sets.
  const setsToday = [...new Map(today.map((a) => [a.set.id, a.set])).values()];
  if (setsToday.length > 0) {
    const when = setsToday
      .map((s) => `${formatTime(s.startsAt)}${s.label ? ` ${s.label}` : ""}`)
      .join(", ");
    items.push({
      text:
        setsToday.length === 1
          ? `You have 1 set today, at ${when}`
          : `You have ${setsToday.length} sets today: ${when}`,
      path: "/calendar",
    });
  }

  // 3. Spots they haven't confirmed yet, on sets still to come.
  const toConfirm = await prisma.assignment.count({
    where: {
      userId,
      status: "PENDING",
      set: { orgId, startsAt: { gte: now } },
    },
  });
  if (toConfirm > 0) {
    items.push({
      text: `Confirm your spot on ${plural(toConfirm, "upcoming set")}`,
      path: "/calendar",
    });
  }

  if (!isAdmin) return items;

  // 4 + 5. The two admin approval queues, counted separately so the DM says
  //        which kind is waiting. Same WHERE clauses as pendingApprovalCount()
  //        in lib/notifications.ts and GET /api/admin/approvals.
  const [swaps, covers] = await Promise.all([
    prisma.swapProposal.count({
      where: { status: "PENDING_APPROVAL", toAssignment: { set: { orgId } } },
    }),
    prisma.assignment.count({
      where: {
        status: "PENDING_APPROVAL",
        pendingCoverFromUserId: { not: null },
        set: { orgId },
      },
    }),
  ]);
  if (swaps > 0) {
    items.push({
      text: `${plural(swaps, "swap request")} waiting on your approval`,
      path: "/approvals",
    });
  }
  if (covers > 0) {
    items.push({
      text: `${plural(covers, "cover request")} waiting on your approval`,
      path: "/approvals",
    });
  }

  // 6. Sets in the next week that still have someone who hasn't confirmed —
  //    i.e. any assignment not yet CONFIRMED. Sets with nobody on them at all
  //    have no unconfirmed PEOPLE, so they don't count here.
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + DIGEST_UPCOMING_DAYS);
  const unsettled = await prisma.set.count({
    where: {
      orgId,
      startsAt: { gte: now, lt: weekEnd },
      assignments: { some: { status: { not: "CONFIRMED" } } },
    },
  });
  if (unsettled > 0) {
    items.push({
      text: `${plural(unsettled, "set")} in the next week ${
        unsettled === 1 ? "has" : "have"
      } people who haven’t confirmed`,
      path: "/calendar",
    });
  }

  return items;
}

/**
 * The digest as Slack mrkdwn: a greeting plus one linked bullet per item.
 * `baseUrl` is the app's public origin (NEXTAUTH_URL); when it's missing the
 * bullets degrade to plain text rather than emitting broken links.
 *
 * Pure — this is the part under unit test.
 */
export function renderDigestText(
  name: string,
  items: DigestItem[],
  baseUrl: string
): string {
  const firstName = name.trim().split(/\s+/)[0] || name;
  const bullets = items.map((item) =>
    baseUrl
      ? `• <${baseUrl}${item.path}|${item.text}>`
      : `• ${item.text}`
  );
  return [`☀️ Good morning ${firstName} — here's your day:`, ...bullets].join(
    "\n"
  );
}

// "1 set" / "3 sets" — every count in the digest reads as a sentence.
function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
