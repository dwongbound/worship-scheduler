// GET /api/cron/daily — the app's single Vercel Cron, and the only scheduled
// work in the app: the free tier allows one cron a day, so everything on a
// timer lives here. It does four jobs:
//   1. Weekly reminders: send every scheduled reminder whose dayOfWeek is today
//      and that hasn't gone out yet today (lastSentAt guard), posting each
//      team's "this week's sets" to Slack.
//   2. Auto group chats: create the private Slack channel for any upcoming set
//      now within its per-set lead window (runDueGroupChats).
//   3. Auto-archive: archive the channels of sets whose date has passed
//      (archiveDueGroupChats).
//   4. Daily digests: DM each person their morning "here's your day" summary,
//      one per org they belong to (sendDailyDigests) — skipped for anyone with
//      nothing to do in that org.
//
// Vercel's free tier only runs crons once per day, so the per-reminder `minute`
// is best-effort (stored for display; the daily run fires them all at once).
// The slot is 16:00 UTC because Vercel schedules in UTC while this app runs in
// APP_TZ: 16:00 UTC is 8 AM PST / 9 AM PDT, inside the digest's morning window
// year-round. Moving it means re-checking DIGEST_WINDOW_* in lib/constants.ts.
// Auth: if CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
// (Vercel sends this automatically); otherwise the route is open (dev/local).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runDueGroupChats,
  archiveDueGroupChats,
  sendDailyDigests,
  sendTeamWeeklySummary,
} from "@/lib/slack";

// This route does the whole day's Slack work in one invocation — reminders,
// group chats, archiving, then a DM per person per org — and every Slack call
// is queued behind a rate limiter. Ask for the longest run the platform will
// give us rather than the default; whatever doesn't finish is picked up by
// tomorrow's run (every job is guarded by its own "already done" stamp).
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );

  // Due = scheduled for today's weekday and not yet sent since midnight.
  const due = await prisma.weeklyReminder.findMany({
    where: {
      dayOfWeek: now.getDay(),
      OR: [{ lastSentAt: null }, { lastSentAt: { lt: startOfToday } }],
    },
    select: { id: true, teamId: true },
  });

  let sent = 0;
  const skipped: { teamId: string; error: string }[] = [];
  for (const r of due) {
    const result = await sendTeamWeeklySummary(r.teamId);
    if (result.ok) {
      await prisma.weeklyReminder.update({
        where: { id: r.id },
        data: { lastSentAt: new Date() },
      });
      sent++;
    } else {
      // e.g. no channel, no sets this week — leave lastSentAt so it retries
      // on the next daily run.
      skipped.push({ teamId: r.teamId, error: result.error });
    }
  }

  // Auto group chats: create the private channel for any set now inside its
  // per-set lead window, and archive channels for sets whose date has passed.
  // Both run every day, independent of the reminders above.
  const groupChats = await runDueGroupChats(now);
  const archived = await archiveDueGroupChats(now);

  // Personal daily digests. Runs last so a slow digest pass can't delay the
  // group chats, and independently of everything above.
  const digests = await sendDailyDigests(now);

  return NextResponse.json({
    due: due.length,
    sent,
    skipped,
    groupChats,
    archived,
    digests,
  });
}
