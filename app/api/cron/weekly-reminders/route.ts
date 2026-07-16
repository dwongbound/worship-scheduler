// GET /api/cron/weekly-reminders — Vercel Cron hits this daily. It sends every
// scheduled reminder whose dayOfWeek is today and that hasn't already gone out
// today (lastSentAt guard), posting each team's "this week's sets" to Slack.
//
// Vercel's free tier only runs crons once per day, so the per-reminder `minute`
// is best-effort (stored for display; the daily run fires them all at once).
// Auth: if CRON_SECRET is set, require `Authorization: Bearer <CRON_SECRET>`
// (Vercel sends this automatically); otherwise the route is open (dev/local).
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendTeamWeeklySummary } from "@/lib/slack";

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

  return NextResponse.json({ due: due.length, sent, skipped });
}
