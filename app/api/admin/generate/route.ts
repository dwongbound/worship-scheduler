// POST /api/admin/generate — the "Generate" button (admin only).
// Body: { weeks?: number } (default 12 ≈ 3 months)
//
// This is a DRY RUN: it computes a proposed schedule and returns it as a
// StagedPlan WITHOUT writing anything. The admin reviews/tweaks the plan in
// the UI, then commits it via POST /api/admin/generate/apply (the only step
// that persists — and, later, sends emails/Slack). Keeping generate side-
// effect-free means bailing out of the review leaves the DB untouched.
//
// It mirrors what apply will do:
//   1. Expand every SetTemplate into concrete occurrences for the next N
//      weeks (deduped by start time; the first template wins a shared slot).
//   2. Skip occurrences whose Set already exists AND already has a team —
//      never restage or clobber a staffed set. Existing-but-empty sets are
//      staged for filling; brand-new occurrences are staged for creation.
//   3. Run the pure scheduling algorithm (lib/scheduler.ts) over the staged
//      sets and attach its proposals as each set's roster.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildSchedule } from "@/lib/scheduler";
import type { Instrument, SlotCapacityMap } from "@/lib/constants";
import { upcomingOccurrences } from "@/lib/dates";
import type { StagedPlan, StagedSet } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const weeks = Math.min(Math.max(Number(body.weeks) || 12, 1), 26);

  const now = new Date();
  const horizon = new Date(now.getTime() + weeks * 7 * MS_PER_DAY);

  // ── Gather everything the scheduler needs (all reads, no writes) ──────
  const [templates, users, rules, existingSets, existing] = await Promise.all([
    prisma.setTemplate.findMany(),
    prisma.user.findMany({ select: { id: true, instruments: true } }),
    prisma.unavailability.findMany(),
    // Sets already in the window + how many people are on each, so we know
    // which occurrences to skip (staffed) vs. fill (empty).
    prisma.set.findMany({
      where: { startsAt: { gte: now, lte: horizon } },
      select: { startsAt: true, _count: { select: { assignments: true } } },
    }),
    // Existing upcoming load per user, so the proposal stays balanced.
    prisma.assignment.groupBy({
      by: ["userId"],
      where: { set: { startsAt: { gte: now } } },
      _count: true,
    }),
  ]);

  const existingByTime = new Map(
    existingSets.map((s) => [s.startsAt.getTime(), s._count.assignments])
  );
  const existingCounts = new Map(existing.map((e) => [e.userId, e._count]));

  // ── 1–2. Templates → the set occurrences worth staging ────────────────
  // Keyed by start time so two templates can't stage the same slot twice.
  const staged = new Map<
    number,
    {
      startsAt: Date;
      label: string | null;
      durationMinutes: number;
      capacities: SlotCapacityMap | null;
      existing: boolean;
    }
  >();
  let skipped = 0;

  for (const template of templates) {
    const occurrences = upcomingOccurrences(
      template.dayOfWeek,
      template.startMinute,
      weeks,
      now
    );
    for (const startsAt of occurrences) {
      const key = startsAt.getTime();
      if (staged.has(key)) continue; // first template wins this slot

      const teamSize = existingByTime.get(key);
      if (teamSize !== undefined && teamSize > 0) {
        skipped++; // already staffed — leave it alone
        continue;
      }

      staged.set(key, {
        startsAt,
        label: template.label,
        durationMinutes: template.durationMinutes,
        capacities: template.slotCapacities as SlotCapacityMap | null,
        existing: existingByTime.has(key),
      });
    }
  }

  // ── 3. Run the scheduler over the staged sets ─────────────────────────
  // Use each set's ISO start time as its scheduler id so we can map the flat
  // list of proposals back onto the right set.
  const stagedList = [...staged.values()];
  const proposals = buildSchedule(
    stagedList.map((s) => ({
      id: s.startsAt.toISOString(),
      startsAt: s.startsAt,
      durationMinutes: s.durationMinutes,
      capacities: s.capacities,
    })),
    users.map((u) => ({ id: u.id, instruments: u.instruments as Instrument[] })),
    rules,
    existingCounts
  );

  const rosters = new Map<string, StagedSet["assignments"]>();
  for (const p of proposals) {
    const roster = rosters.get(p.setId) ?? [];
    roster.push({ userId: p.userId, role: p.role });
    rosters.set(p.setId, roster);
  }

  const sets: StagedSet[] = stagedList
    .map((s) => ({
      startsAt: s.startsAt.toISOString(),
      label: s.label,
      durationMinutes: s.durationMinutes,
      slotCapacities: s.capacities,
      existing: s.existing,
      assignments: rosters.get(s.startsAt.toISOString()) ?? [],
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const plan: StagedPlan = { sets, skipped };
  return NextResponse.json(plan);
}
