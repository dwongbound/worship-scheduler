// PATCH /api/sets/:id — edit a set's notes. Allowed for admins and for the
// set's worship leader (they run the set, so they own its notes).
// DELETE /api/sets/:id — an admin removes a set entirely (its assignments
// cascade). Used by the "Delete set" button in the set detail modal.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  if (typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  // Permission: an admin, or the worship leader assigned to this set.
  const admin = await getAdminUser();
  let allowed = !!admin;
  if (!allowed) {
    const leaderSlot = await prisma.assignment.findFirst({
      where: { setId: id, userId: user.id, role: "WORSHIP_LEADER" },
    });
    allowed = !!leaderSlot;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const set = await prisma.set.update({
      where: { id },
      data: { notes: body.notes.trim() || null },
    });
    return NextResponse.json(set);
  } catch {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  // Assignments cascade on Set delete (see schema onDelete: Cascade).
  const result = await prisma.set.deleteMany({ where: { id } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
