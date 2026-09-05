// GET /api/admin/team-load?metric=<window>&ref=<ISO date> — how many slots each
// member of this org fills within that window, as { userId: count }.
//
// `metric` is one of lib/loadMetrics.ts's windows; `ref` is the date the
// neighbourhood windows ("calendar-month", "around-2w") centre on, defaulting
// to now. Backs the "Team load" panel in the generate-review modal
// (StagedScheduleModal) and the ×n badges in the set detail modal's assignment
// dropdowns — which passes its set's date as `ref`, so "calendar month" means
// the month THAT set is in.
//
// DELIBERATELY its own endpoint: half a year of assignments is a much bigger
// read than the page that wants it, and the client caches each window it asks
// for. Shipping every window with every page would have made everyone pay for
// a view most of them never open.
//
// Scoped to the caller's admin org — unlike the scheduler's balancing tallies
// (deliberately cross-org), this is shown to a person, and another org's roster
// isn't theirs to read.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { loadMetricRange, parseLoadMetric } from "@/lib/loadMetrics";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metric = parseLoadMetric(req.nextUrl.searchParams.get("metric"));
  // The date the neighbourhood windows centre on. A junk value is ignored
  // rather than fatal — it just means "now", which is the default anyway.
  const rawRef = req.nextUrl.searchParams.get("ref");
  const parsedRef = rawRef ? new Date(rawRef) : null;
  const ref =
    parsedRef && !Number.isNaN(parsedRef.getTime()) ? parsedRef : undefined;
  // "plan" is counted from the staged plan client-side, so asking for it here
  // is a mistake rather than an empty window.
  const range = metric === null ? null : loadMetricRange(metric, { ref });
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
