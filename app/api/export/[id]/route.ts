// GET /api/export/:id — a single set as a one-event .ics file. The event
// title carries the current user's role(s) on that set (see setEventTitle),
// matching the whole-calendar export at /api/export.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { canViewSet } from "@/lib/sets";
import { buildIcs, setEventTitle } from "@/lib/ics";
import { INSTRUMENT_LABELS, type Instrument } from "@/lib/constants";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const set = await prisma.set.findUnique({ where: { id } });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // My role(s) on this set — empty if I'm not assigned (title is just the
  // set name in that case).
  const mine = await prisma.assignment.findMany({
    where: { setId: id, userId: user.id },
  });
  const roles = mine.map((a) => a.role as Instrument);

  // A private set may only be exported by its assigned people and org admins;
  // to anyone else it looks like it doesn't exist (matches GET /api/sets). The
  // viewer's own rows in `mine` tell us whether they're assigned.
  const visible = canViewSet(
    { isPrivate: set.isPrivate, assignedUserIds: mine.map((a) => a.userId) },
    { userId: user.id, isOrgAdmin: !!(await requireOrgAdminFor(set.orgId)) }
  );
  if (!visible) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  const ics = buildIcs([
    {
      id: set.id,
      title: setEventTitle(set.label, roles),
      description: roles.length
        ? `Role: ${roles.map((r) => INSTRUMENT_LABELS[r]).join(", ")}`
        : undefined,
      start: set.startsAt,
      durationMinutes: set.durationMinutes,
    },
  ]);

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="worship-set.ics"',
    },
  });
}
