// DELETE /api/sets/:id/practices/:practiceId — drop one practice. Org admin
// only; the org is derived from the set the practice hangs off, and the
// practice must belong to THAT set (so an id from another set can't be used to
// delete across orgs).
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  calendarEventOfPractice,
  deleteSetCalendarEvent,
} from "@/lib/googleCalendar";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const { id, practiceId } = await params;
  const practice = await prisma.setPractice.findUnique({
    where: { id: practiceId },
    select: { setId: true, set: { select: { orgId: true } } },
  });
  if (!practice || practice.setId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(practice.set.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Read the event id while the row still exists, then cancel it after —
  // Google emails the guests the cancellation, which is the whole point of
  // deleting a practice.
  const event = await calendarEventOfPractice(practiceId);
  await prisma.setPractice.delete({ where: { id: practiceId } });
  await deleteSetCalendarEvent(event);
  return NextResponse.json({ ok: true });
}
