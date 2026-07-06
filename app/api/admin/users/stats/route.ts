// GET /api/admin/users/stats?start=<ISO>&end=<ISO> — for each user, how many
// sets they're on within the given date range, broken down by set type (the
// set's label). Powers the team stats panel on the Users tab. Admin only.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Per-user list of set-type counts, e.g. [{ label: "Sunday Worship", count: 3 }].
export type UserSetBreakdown = { label: string; count: number };

// Ad-hoc sets have no label — mirror the "Worship Set" fallback used elsewhere.
const NO_LABEL = "Worship Set";

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
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

  // Pull the assignments in range with just the user id and their set's label,
  // then tally per user by label in memory (label lives on Set, so it can't be
  // a groupBy key on Assignment).
  const assignments = await prisma.assignment.findMany({
    where: { set: { startsAt: { gte: start, lte: end } } },
    select: { userId: true, set: { select: { label: true } } },
  });

  // userId → (label → count)
  const tally = new Map<string, Map<string, number>>();
  for (const a of assignments) {
    const label = a.set.label ?? NO_LABEL;
    const byLabel = tally.get(a.userId) ?? new Map<string, number>();
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
    tally.set(a.userId, byLabel);
  }

  // Shape into userId → breakdown[], each sorted by count (desc) then label.
  const result: Record<string, UserSetBreakdown[]> = {};
  for (const [userId, byLabel] of tally) {
    result[userId] = [...byLabel.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }

  return NextResponse.json(result);
}
