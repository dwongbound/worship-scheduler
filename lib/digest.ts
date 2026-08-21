// The daily digest: one Slack DM per person per org, each morning around
// DIGEST_SEND_MINUTE (8 AM), listing only the things that need them — availability to
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
import {
  DIGEST_UPCOMING_DAYS,
  DIGEST_UPCOMING_DAYS_MAX,
  DIGEST_UPCOMING_DAYS_MIN,
  windowPhrase,
} from "./constants";
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
  opts: { isAdmin: boolean; orgName: string; upcomingDays: number; now: Date }
): Promise<DigestItem[]> {
  const { isAdmin, orgName, now } = opts;
  // The org's look-ahead window (Org.digestUpcomingDays, set on the Org
  // settings page), clamped in case a bad value ever reaches the db.
  const upcomingDays = clampUpcomingDays(opts.upcomingDays);

  // The digest always describes the day it's sent on. (The send time is fixed
  // to a morning window, so "today" is never ambiguous the way an evening send
  // would be.)
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  // The far edge of the look-ahead window, shared by the two "coming up" items
  // so they always agree with each other and with the copy.
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + upcomingDays);

  // Every section is independent, so they all go out at once. This runs once
  // per person per org on a single cron invocation — serially it was six round
  // trips deep per person, which is what put the run near its time budget.
  const [request, today, toConfirm, approvals, unsettled] = await Promise.all([
    // 1. Availability — the org's active (most recent) request that targets
    //    this person. Mirrors availabilityStatus() in lib/notifications.ts.
    prisma.availabilityRequest.findFirst({
      where: { orgId, ...targetsUser(userId) },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),

    // 2. Sets today — what they're actually playing on, with times.
    prisma.assignment.findMany({
      where: {
        userId,
        set: { orgId, startsAt: { gte: dayStart, lt: dayEnd } },
      },
      select: { set: { select: { id: true, label: true, startsAt: true } } },
      orderBy: { set: { startsAt: "asc" } },
    }),

    // 3. Spots they haven't confirmed yet, WITHIN the window. Bounded on
    //    purpose: unbounded, a single unconfirmed set months out re-sent this
    //    line every morning forever and the digest was never empty.
    prisma.assignment.count({
      where: {
        userId,
        status: "PENDING",
        set: { orgId, startsAt: { gte: now, lt: windowEnd } },
      },
    }),

    // 4 + 5. The two admin approval queues, counted separately so the DM says
    //        which kind is waiting. Same WHERE clauses as pendingApprovalCount()
    //        in lib/notifications.ts and GET /api/admin/approvals.
    isAdmin
      ? Promise.all([
          prisma.swapProposal.count({
            where: {
              status: "PENDING_APPROVAL",
              toAssignment: { set: { orgId } },
            },
          }),
          prisma.assignment.count({
            where: {
              status: "PENDING_APPROVAL",
              pendingCoverFromUserId: { not: null },
              set: { orgId },
            },
          }),
        ])
      : Promise.resolve([0, 0] as const),

    // 6. Sets in the window that still have someone who hasn't confirmed —
    //    i.e. any assignment not yet CONFIRMED. Sets with nobody on them at all
    //    have no unconfirmed PEOPLE, so they don't count here.
    isAdmin
      ? prisma.set.count({
          where: {
            orgId,
            startsAt: { gte: now, lt: windowEnd },
            assignments: { some: { status: { not: "CONFIRMED" } } },
          },
        })
      : Promise.resolve(0),
  ]);

  // Assembled in a fixed order — most time-critical first — so the DM reads the
  // same way every morning.
  const items: DigestItem[] = [];

  if (request) {
    // Only the request itself could be fetched in parallel; whether they owe it
    // a response depends on which request came back.
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

  if (toConfirm > 0) {
    items.push({
      text: `Confirm your spot on ${plural(toConfirm, "set")} ${windowPhrase(upcomingDays)}`,
      path: "/calendar",
    });
  }

  if (!isAdmin) return items;

  const [swaps, covers] = approvals;
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

  if (unsettled > 0) {
    items.push({
      text: `${plural(unsettled, "set")} ${windowPhrase(upcomingDays)} ${
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

// A stored window outside the allowed range would silently distort every count,
// so it's clamped on read as well as validated on write (the API route).
function clampUpcomingDays(days: number): number {
  if (!Number.isFinite(days)) return DIGEST_UPCOMING_DAYS;
  return Math.min(
    DIGEST_UPCOMING_DAYS_MAX,
    Math.max(DIGEST_UPCOMING_DAYS_MIN, Math.round(days))
  );
}
