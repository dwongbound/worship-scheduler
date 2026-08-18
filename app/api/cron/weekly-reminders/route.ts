// GET /api/cron/weekly-reminders — the app's single daily Vercel Cron. It does
// two jobs:
//   1. Weekly reminders: send every scheduled reminder whose dayOfWeek is today
//      and that hasn't gone out yet today (lastSentAt guard), posting each
//      team's "this week's sets" to Slack.
//   2. Auto group chats: create the private Slack channel for any upcoming set
//      now within its per-set lead window (runDueGroupChats), and archive the
//      channels of sets whose event date has passed (archiveDueGroupChats).
//
// Vercel's free tier only runs crons once per day, so the per-reminder `minute`
// is best-effort (stored for display; the daily run fires them all at once).
// Auth: if CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
// (Vercel sends this automatically); otherwise the route is open (dev/local).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  runDueGroupChats,
  archiveDueGroupChats,
  sendTeamWeeklySummary,
} from "@/lib/slack";

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

  return NextResponse.json({ due: due.length, sent, skipped, groupChats, archived });
}
