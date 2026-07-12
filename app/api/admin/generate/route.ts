// POST /api/admin/generate — the "Generate" button (admin only).
// Body: either { weeks?: number } (default 12 ≈ 3 months) OR
//       { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD" } for an explicit
//       window. The date range wins when both dates are supplied.
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
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { buildSchedule } from "@/lib/scheduler";
import type { Instrument, SlotCapacityMap } from "@/lib/constants";
import { occurrencesInRange, parseLocalDate, upcomingOccurrences } from "@/lib/dates";
import type { StagedPlan, StagedSet } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Three modes: N weeks ahead, an explicit [startDate, endDate] window, or the
  // range of a named availability request (so you can schedule exactly the span
  // you asked the team about). A requestId resolves to its stored dates.
  let rangeStart = parseLocalDate(body.startDate);
  let rangeEnd = parseLocalDate(body.endDate);

  if (!rangeStart && !rangeEnd && typeof body.requestId === "string") {
    const request = await prisma.availabilityRequest.findUnique({
      where: { id: body.requestId },
    });
    if (request && request.orgId !== admin.orgId) {
      return NextResponse.json(
        { error: "Availability request not found" },
        { status: 404 }
      );
    }
    if (!request) {
      return NextResponse.json(
        { error: "Availability request not found" },
        { status: 404 }
      );
    }
    // Stored at local midnight — use directly (same convention as the range).
    rangeStart = request.startDate;
    rangeEnd = request.endDate;
  }

  const useRange = !!rangeStart && !!rangeEnd;

  if ((body.startDate || body.endDate) && !useRange) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  if (rangeStart && rangeEnd && rangeStart > rangeEnd) {
    return NextResponse.json(
      { error: "Start date must be on or before end date" },
      { status: 400 }
    );
  }

  const weeks = Math.min(Math.max(Number(body.weeks) || 12, 1), 26);

  // The scheduling window. Range mode covers whole days (start-of-day →
  // end-of-day); weeks mode runs from now for N weeks.
  const now = new Date();
  const windowStart = useRange ? rangeStart! : now;
  const windowEnd = useRange
    ? new Date(rangeEnd!.getTime() + MS_PER_DAY - 1) // inclusive end-of-day
    : new Date(now.getTime() + weeks * 7 * MS_PER_DAY);

  // ── Gather everything the scheduler needs (all reads, no writes) ──────
  // Bookings within a week of the window feed the spacing rule, so staged
  // sets also steer away from people already serving just before/after it.
  const spacingStart = new Date(windowStart.getTime() - 8 * MS_PER_DAY);
  const spacingEnd = new Date(windowEnd.getTime() + 8 * MS_PER_DAY);
  const [templates, users, rules, existingSets, existing, booked] =
    await Promise.all([
    prisma.setTemplate.findMany({ where: { orgId: admin.orgId } }),
    // The candidate pool = this org's members. A null-teamId set draws from
    // this whole pool, which is exactly "open to everyone in the org".
    prisma.user.findMany({
      where: { memberships: { some: { orgId: admin.orgId } } },
      select: {
        id: true,
        instruments: true,
        isMD: true,
        teams: { select: { id: true } },
      },
    }),
    // Deliberately unscoped: busy blocks are global to the person, so a block
    // entered for another org's request still applies here.
    prisma.unavailability.findMany(),
    // Sets already in the window + how many people are on each, so we know
    // which occurrences to skip (staffed) vs. fill (empty). We match on BOTH
    // start time AND label, so a "block that already exists with the same name
    // at that time" is recognized (and never recreated); a differently-named
    // set at the same time is treated as a separate event.
    prisma.set.findMany({
      where: { orgId: admin.orgId, startsAt: { gte: windowStart, lte: windowEnd } },
      select: {
        startsAt: true,
        label: true,
        _count: { select: { assignments: true } },
      },
    }),
    // Existing upcoming load per user, so the proposal stays balanced.
    // Deliberately cross-org: someone slammed in another org shouldn't also
    // be first pick here (mirrors how busy blocks span orgs).
    prisma.assignment.groupBy({
      by: ["userId"],
      where: { set: { startsAt: { gte: now } } },
      _count: true,
    }),
    // Who's already booked near the window (see spacingStart/End above) —
    // also cross-org, so the spacing rule sees ALL of a person's bookings.
    prisma.assignment.findMany({
      where: { set: { startsAt: { gte: spacingStart, lte: spacingEnd } } },
      select: { userId: true, set: { select: { startsAt: true } } },
    }),
  ]);

  // Key existing sets by "startTime|label" so the match is name-and-time exact.
  // The value is the set's current team size (0 = exists but empty).
  const existingKey = (startsAt: Date, label: string | null) =>
    `${startsAt.getTime()}|${label ?? ""}`;
  const existingByKey = new Map(
    existingSets.map((s) => [existingKey(s.startsAt, s.label), s._count.assignments])
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
      requiresMD: boolean;
      teamId: string | null;
      existing: boolean;
    }
  >();
  let skipped = 0;

  for (const template of templates) {
    const occurrences = useRange
      ? occurrencesInRange(
          template.dayOfWeek,
          template.startMinute,
          windowStart,
          windowEnd
        )
      : upcomingOccurrences(
          template.dayOfWeek,
          template.startMinute,
          weeks,
          now
        );
    for (const startsAt of occurrences) {
      const key = startsAt.getTime();
      if (staged.has(key)) continue; // first template wins this time slot

      // Does a set with THIS name already exist at THIS time?
      const matchKey = existingKey(startsAt, template.label);
      const teamSize = existingByKey.get(matchKey);
      if (teamSize !== undefined && teamSize > 0) {
        skipped++; // already exists AND staffed — leave it alone
        continue;
      }

      staged.set(key, {
        startsAt,
        label: template.label,
        durationMinutes: template.durationMinutes,
        capacities: template.slotCapacities as SlotCapacityMap | null,
        requiresMD: template.requiresMD,
        teamId: template.teamId,
        existing: existingByKey.has(matchKey),
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
      requiresMD: s.requiresMD,
      teamId: s.teamId,
    })),
    users.map((u) => ({
      id: u.id,
      instruments: u.instruments as Instrument[],
      isMD: u.isMD,
      teamIds: u.teams.map((t) => t.id),
    })),
    rules,
    existingCounts,
    booked.map((b) => ({ userId: b.userId, startsAt: b.set.startsAt }))
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
      requiresMD: s.requiresMD,
      slotCapacities: s.capacities,
      teamId: s.teamId,
      existing: s.existing,
      assignments: rosters.get(s.startsAt.toISOString()) ?? [],
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  const plan: StagedPlan = { sets, skipped };
  return NextResponse.json(plan);
}
