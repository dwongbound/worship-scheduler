// PATCH /api/sets/:id — edit a set's notes (org admins + the set's worship
// leader, who runs it) or its designated MD (org admins only). Send { notes }
// or { mdUserId } (mdUserId: null clears the MD).
// DELETE /api/sets/:id — an org admin removes a set entirely (its assignments
// cascade). Used by the "Delete set" button in the set detail modal.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { isValidMD } from "@/lib/md";

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
  const editingMD = "mdUserId" in body;
  if (!editingMD && typeof body.notes !== "string") {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Permission: MD edits are admin-only; notes may also be edited by the set's
  // assigned worship leader.
  const admin = await requireOrgAdminFor(set.orgId);
  let allowed = !!admin;
  if (!allowed && !editingMD) {
    const leaderSlot = await prisma.assignment.findFirst({
      where: { setId: id, userId: user.id, role: "WORSHIP_LEADER" },
    });
    allowed = !!leaderSlot;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (editingMD) {
    const mdUserId = body.mdUserId;
    if (mdUserId !== null && typeof mdUserId !== "string") {
      return NextResponse.json({ error: "Invalid mdUserId" }, { status: 400 });
    }
    // A non-null MD must be an eligible assignee (isMD, MD-capable role, not WL).
    if (mdUserId !== null) {
      const assignments = await prisma.assignment.findMany({
        where: { setId: id },
        select: { userId: true, role: true, user: { select: { isMD: true } } },
      });
      const eligible = isValidMD(
        mdUserId,
        assignments.map((a) => ({
          userId: a.userId,
          role: a.role,
          isMD: a.user.isMD,
        }))
      );
      if (!eligible) {
        return NextResponse.json(
          { error: "That person can't be the MD of this set." },
          { status: 400 }
        );
      }
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { mdUserId },
    });
    return NextResponse.json(updated);
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
