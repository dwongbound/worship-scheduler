// GET /api/admin/users/stats?start=<ISO>&end=<ISO> — per-user activity within
// the range, for the team stats panel on the Users tab. Admin only.
//   • sets grouped BY TEAM (not by event/label), e.g. "Sunday Team: 5",
//   • coversRequested / coversTaken — open-cover requests raised / taken,
//   • swapsRequested / swapsTaken — targeted trades initiated / accepted.
// Every count is scoped to sets whose start time falls in [start, end].
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

// One team's set count for a user, e.g. { label: "Sunday Team", count: 3 }.
export type UserSetBreakdown = { label: string; count: number };

// The full per-user stats bundle the panel renders.
export type UserStats = {
  teams: UserSetBreakdown[];
  coversRequested: number;
  coversTaken: number;
  swapsRequested: number;
  swapsTaken: number;
};

// Sets with no team are "open to the whole org" — group them under this label.
const NO_TEAM = "No team";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const startParam = req.nextUrl.searchParams.get("start");
  const endParam = req.nextUrl.searchParams.get("end");
  const start = startParam ? new Date(startParam) : null;
  const end = endParam ? new Date(endParam) : null;
  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    return NextResponse.json(
      { error: "start and end query params (ISO dates) are required" },
      { status: 400 }
    );
  }

  const orgId = admin.orgId;
  const inRange = { orgId, startsAt: { gte: start, lte: end } };

  // Everything we need, in parallel: assignments (for the team breakdown),
  // cover history events, and swap proposals.
  const [assignments, coverEvents, requested, taken] = await Promise.all([
    prisma.assignment.findMany({
      where: { set: inRange },
      select: {
        userId: true,
        set: { select: { team: { select: { name: true } } } },
      },
    }),
    // Open-cover activity, keyed by who did it.
    prisma.setHistoryEvent.findMany({
      where: {
        type: { in: ["SWAP_REQUESTED", "SWAP_TAKEN"] },
        actorId: { not: null },
        set: inRange,
      },
      select: { actorId: true, type: true },
    }),
    // Targeted trades initiated (by the requester), tied to their own set.
    prisma.swapProposal.findMany({
      where: { fromAssignment: { set: inRange } },
      select: { requestedById: true },
    }),
    // Targeted trades accepted (by the recipient), tied to the set they took.
    prisma.swapProposal.findMany({
      where: { status: "ACCEPTED", fromAssignment: { set: inRange } },
      select: { recipientId: true },
    }),
  ]);

  // Seed a per-user stats object lazily as we encounter each user.
  const result: Record<string, UserStats> = {};
  const statsFor = (userId: string): UserStats =>
    (result[userId] ??= {
      teams: [],
      coversRequested: 0,
      coversTaken: 0,
      swapsRequested: 0,
      swapsTaken: 0,
    });

  // Sets by team → a per-user Map(teamName → count) we shape into teams[] below.
  const teamTally = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const team = a.set.team?.name ?? NO_TEAM;
    const byTeam = teamTally.get(a.userId) ?? new Map<string, number>();
    byTeam.set(team, (byTeam.get(team) ?? 0) + 1);
    teamTally.set(a.userId, byTeam);
  }
  for (const [userId, byTeam] of teamTally) {
    statsFor(userId).teams = [...byTeam.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  for (const e of coverEvents) {
    const s = statsFor(e.actorId!);
    if (e.type === "SWAP_REQUESTED") s.coversRequested += 1;
    else s.coversTaken += 1;
  }
  for (const p of requested) statsFor(p.requestedById).swapsRequested += 1;
  for (const p of taken) statsFor(p.recipientId).swapsTaken += 1;

  return NextResponse.json(result);
}
