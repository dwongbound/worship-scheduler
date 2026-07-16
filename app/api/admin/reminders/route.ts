// GET /api/admin/reminders — the org's scheduled weekly Slack reminders (Org
// settings page). POST — create one for a team at a day + time. Org comes from
// the x-org-id header; admin of that org only.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import type { ApiWeeklyReminder } from "@/lib/types";

function serialize(r: {
  id: string;
  teamId: string;
  dayOfWeek: number;
  minute: number;
  lastSentAt: Date | null;
  team: { name: string; slackChannelId: string | null };
}): ApiWeeklyReminder {
  return {
    id: r.id,
    teamId: r.teamId,
    teamName: r.team.name,
    teamSlackChannelId: r.team.slackChannelId,
    dayOfWeek: r.dayOfWeek,
    minute: r.minute,
    lastSentAt: r.lastSentAt?.toISOString() ?? null,
  };
}

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const reminders = await prisma.weeklyReminder.findMany({
    where: { orgId: admin.orgId },
    orderBy: [{ dayOfWeek: "asc" }, { minute: "asc" }],
    include: { team: { select: { name: true, slackChannelId: true } } },
  });
  return NextResponse.json(reminders.map(serialize));
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { teamId, dayOfWeek, minute } = await req.json();
  if (
    typeof teamId !== "string" ||
    !Number.isInteger(dayOfWeek) ||
    dayOfWeek < 0 ||
    dayOfWeek > 6 ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 1439
  ) {
    return NextResponse.json({ error: "Invalid reminder" }, { status: 400 });
  }

  // The team must belong to this admin's org — no cross-org scheduling.
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { orgId: true },
  });
  if (!team || team.orgId !== admin.orgId) {
    return NextResponse.json({ error: "Unknown team" }, { status: 400 });
  }

  try {
    const created = await prisma.weeklyReminder.create({
      data: { orgId: admin.orgId, teamId, dayOfWeek, minute },
      include: { team: { select: { name: true, slackChannelId: true } } },
    });
    return NextResponse.json(serialize(created), { status: 201 });
  } catch {
    // The only failure is the per-team-per-weekday unique constraint.
    return NextResponse.json(
      { error: "That team already has a reminder on that day." },
      { status: 409 }
    );
  }
}
