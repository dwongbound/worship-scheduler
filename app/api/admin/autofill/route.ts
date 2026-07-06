// POST /api/admin/autofill — propose a team for ONE custom set (admin only).
// Body: { label?, startsAt, durationMinutes, slotCapacities? } — the same
// fields the "New set" form collects.
//
// Like /api/admin/generate this is a DRY RUN: it returns a StagedPlan (a
// single set with a proposed roster) and writes nothing. The admin reviews it
// in the same modal and commits via POST /api/admin/generate/apply.
//
// Unlike the bulk generator it balances against NEIGHBORING days: anyone
// already serving on the previous/same/next calendar day is skipped, so a
// one-off set doesn't pile onto people who just played.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  validateSlotCapacities,
  type Instrument,
  type SlotCapacityMap,
} from "@/lib/constants";
import { buildSchedule } from "@/lib/scheduler";
import type { StagedPlan, StagedSet } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Whole-day distance between two instants in the server's local calendar
// (0 = same day, 1 = adjacent day). Used to spot "neighboring" sets.
function dayDistance(a: Date, b: Date): number {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((da.getTime() - db.getTime()) / MS_PER_DAY);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { label, startsAt, durationMinutes, slotCapacities } = await req.json();

  const start = new Date(startsAt);
  if (
    (label !== undefined && label !== null && typeof label !== "string") ||
    Number.isNaN(start.getTime()) ||
    typeof durationMinutes !== "number" ||
    durationMinutes <= 0
  ) {
    return NextResponse.json({ error: "Invalid set" }, { status: 400 });
  }

  let capacities: SlotCapacityMap | null = null;
  if (slotCapacities !== undefined && slotCapacities !== null) {
    capacities = validateSlotCapacities(slotCapacities);
    if (!capacities) {
      return NextResponse.json(
        { error: "Invalid slot capacities" },
        { status: 400 }
      );
    }
  }

  const windowStart = new Date(start.getTime() - 2 * MS_PER_DAY);
  const windowEnd = new Date(start.getTime() + 2 * MS_PER_DAY);

  const [users, rules, neighbors, existing, existingSet] = await Promise.all([
    prisma.user.findMany({ select: { id: true, instruments: true } }),
    prisma.unavailability.findMany(),
    // Sets near this time, with just their rosters — to know who's busy.
    prisma.set.findMany({
      where: { startsAt: { gte: windowStart, lte: windowEnd } },
      select: { startsAt: true, assignments: { select: { userId: true } } },
    }),
    // Upcoming load per user, so ties still favor the least-scheduled.
    prisma.assignment.groupBy({
      by: ["userId"],
      where: { set: { startsAt: { gte: new Date() } } },
      _count: true,
    }),
    // Does a set already exist at this exact time? (apply would fill it.)
    prisma.set.findFirst({ where: { startsAt: start }, select: { id: true } }),
  ]);

  // Anyone on a set within one calendar day is off-limits for this one.
  const busyNearby = new Set<string>();
  for (const n of neighbors) {
    if (Math.abs(dayDistance(n.startsAt, start)) <= 1) {
      for (const a of n.assignments) busyNearby.add(a.userId);
    }
  }

  const eligible = users
    .filter((u) => !busyNearby.has(u.id))
    .map((u) => ({ id: u.id, instruments: u.instruments as Instrument[] }));
  const existingCounts = new Map(existing.map((e) => [e.userId, e._count]));

  const proposals = buildSchedule(
    [
      {
        id: start.toISOString(),
        startsAt: start,
        durationMinutes,
        capacities,
      },
    ],
    eligible,
    rules,
    existingCounts
  );

  const set: StagedSet = {
    startsAt: start.toISOString(),
    label: typeof label === "string" && label.trim() ? label.trim() : null,
    durationMinutes,
    slotCapacities: capacities,
    existing: existingSet !== null,
    assignments: proposals.map((p) => ({ userId: p.userId, role: p.role })),
  };

  const plan: StagedPlan = { sets: [set], skipped: 0 };
  return NextResponse.json(plan);
}
