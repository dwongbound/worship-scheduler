// GET /api/admin/team-load?metric=upcoming|30|90|182|365 — how many sets each
// member of this org is on within that window, as { userId: count }.
//
// Backs the "Team load" panel in the generate-review modal (StagedScheduleModal),
// and is DELIBERATELY its own endpoint: a year of assignments is a much bigger
// read than the plan itself, most runs never leave the default "In this plan"
// view, and the client caches each window it asks for. Shipping it with every
// plan would have made every generate pay for a view almost nobody opens.
//
// Scoped to the caller's admin org — unlike the scheduler's balancing tallies
// (deliberately cross-org), this is shown to a person, and another org's roster
// isn't theirs to read.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { loadMetricRange, parseLoadMetric } from "@/lib/stagedPlan";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metric = parseLoadMetric(req.nextUrl.searchParams.get("metric"));
  // "plan" is counted from the staged plan client-side, so asking for it here
  // is a mistake rather than an empty window.
  const range = metric ? loadMetricRange(metric) : null;
  if (!range) {
    return NextResponse.json({ error: "Unknown metric" }, { status: 400 });
  }

  // groupBy does the counting in the database — the rows themselves are never
  // needed, only how many each person has.
  const rows = await prisma.assignment.groupBy({
    by: ["userId"],
    where: {
      set: {
        orgId: admin.orgId,
        startsAt: range.end
          ? { gte: range.start, lt: range.end }
          : { gte: range.start },
      },
    },
    _count: { _all: true },
  });

  return NextResponse.json({
    counts: Object.fromEntries(rows.map((r) => [r.userId, r._count._all])),
  });
}
