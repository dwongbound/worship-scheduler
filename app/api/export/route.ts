// GET /api/export — the current user's upcoming sets as an .ics file,
// ready to drag into any calendar app.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildIcs, setEventTitle } from "@/lib/ics";
import { INSTRUMENT_LABELS, type Instrument } from "@/lib/constants";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { userId: user.id, set: { startsAt: { gte: new Date() } } },
    include: { set: true },
    orderBy: { set: { startsAt: "asc" } },
  });

  // One event per set (a person could hold more than one role on it), with
  // all of my roles collected into the title — see setEventTitle. The Map
  // keeps the chronological order from the query above.
  type SetRow = (typeof assignments)[number]["set"];
  const bySet = new Map<string, { set: SetRow; roles: Instrument[] }>();
  for (const a of assignments) {
    const entry = bySet.get(a.setId) ?? { set: a.set, roles: [] };
    entry.roles.push(a.role as Instrument);
    bySet.set(a.setId, entry);
  }

  const ics = buildIcs(
    [...bySet.values()].map(({ set, roles }) => ({
      id: set.id,
      title: setEventTitle(set.label, roles),
      description: `Role: ${roles.map((r) => INSTRUMENT_LABELS[r]).join(", ")}`,
      start: set.startsAt,
      durationMinutes: set.durationMinutes,
    }))
  );

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="worship-sets.ics"',
    },
  });
}
