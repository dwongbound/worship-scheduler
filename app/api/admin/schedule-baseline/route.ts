// GET /api/admin/schedule-baseline?from=<iso>&to=<iso> — the starting state an
// auto-fill over that window needs, in exactly the shape StagedPlan.baseline
// has: the load tallies, who's booked near the window, and what the org's
// scheduling rules read from outside it.
//
// POST /api/admin/generate builds this inline for a generated plan. The
// calendar's PREVIEW MODE has no generate step — it stages sets that already
// exist — so without this it ran "Auto schedule" from an empty baseline: every
// tally at zero, no spacing, and (the real bug) no rule context, so a LIMIT
// rule counted no bookings and a SAME_PLAYER rule couldn't find a partner set
// outside the preview. The rules were passed and obeyed; they were just blind.
//
// Org admins only (the x-org-id header names the org, re-checked against the
// db) — it reports who is booked when across the org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { teamKey } from "@/lib/scheduler";
import { loadOrgRules, ruleContext } from "@/lib/schedulingRuleStore";
import type { StagedPlan } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const from = new Date(req.nextUrl.searchParams.get("from") ?? "");
  const to = new Date(req.nextUrl.searchParams.get("to") ?? "");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return NextResponse.json({ error: "Bad window" }, { status: 400 });
  }

  // The same two spans the generate route uses: ±8 days for the spacing rule,
  // and everything still upcoming for the load tallies.
  const spacingStart = new Date(from.getTime() - 8 * MS_PER_DAY);
  const spacingEnd = new Date(to.getTime() + 8 * MS_PER_DAY);
  const now = new Date();

  const rules = await loadOrgRules(admin.orgId);
  const [existing, booked, lastLedSets, context] = await Promise.all([
    // Upcoming load per person, cross-org for the reason the generate route is:
    // someone slammed in another org shouldn't also be first pick here.
    prisma.assignment.findMany({
      where: { set: { startsAt: { gte: now } } },
      select: { userId: true, set: { select: { teamId: true } } },
    }),
    prisma.assignment.findMany({
      where: { set: { startsAt: { gte: spacingStart, lte: spacingEnd } } },
      select: { userId: true, set: { select: { startsAt: true } } },
    }),
    // Each team's last LED set before the window — the MD rotation's seed.
    prisma.set.findMany({
      where: { orgId: admin.orgId, startsAt: { lt: from }, mdUserId: { not: null } },
      orderBy: { startsAt: "asc" },
      select: { teamId: true, mdUserId: true },
    }),
    // Skipped entirely when no rule is switched on — it's several queries, and
    // nothing would read the answer.
    rules.some((r) => r.enabled)
      ? ruleContext(admin.orgId, rules, from, to)
      : Promise.resolve({ fixedSets: [], periodBookings: [] }),
  ]);

  const counts = new Map<string, number>();
  const teamCounts = new Map<string, number>();
  for (const a of existing) {
    counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    const key = teamKey(a.userId, a.set.teamId);
    teamCounts.set(key, (teamCounts.get(key) ?? 0) + 1);
  }

  const baseline: NonNullable<StagedPlan["baseline"]> = {
    counts: Object.fromEntries(counts),
    teamCounts: Object.fromEntries(teamCounts),
    booked: booked.map((b) => ({
      userId: b.userId,
      startsAt: b.set.startsAt.toISOString(),
    })),
    previousMDByTeam: Object.fromEntries(
      lastLedSets.map((s) => [s.teamId ?? "", s.mdUserId])
    ),
    fixedSets: context.fixedSets.map((f) => ({
      ...f,
      startsAt: f.startsAt.toISOString(),
    })),
    periodBookings: context.periodBookings.map((b) => ({
      userId: b.userId,
      startsAt: b.startsAt.toISOString(),
    })),
  };
  return NextResponse.json({ baseline, rules });
}
