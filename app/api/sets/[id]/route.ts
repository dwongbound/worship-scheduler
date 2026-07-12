// PATCH /api/sets/:id — edit a set's notes. Allowed for the set's org admins
// and for the set's worship leader (they run the set, so they own its notes).
// DELETE /api/sets/:id — an org admin removes a set entirely (its assignments
// cascade). Used by the "Delete set" button in the set detail modal.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
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

  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Permission: an admin of the set's org, or its assigned worship leader.
  const admin = await requireOrgAdminFor(set.orgId);
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

  const updated = await prisma.set.update({
    where: { id },
    data: { notes: body.notes.trim() || null },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Assignments cascade on Set delete (see schema onDelete: Cascade).
  await prisma.set.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
