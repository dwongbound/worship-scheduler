// PATCH   /api/admin/assignments/:id — reassign a slot to a different person.
// DELETE  /api/admin/assignments/:id — clear the slot.
// Org admin only (org derived from the assignment's set). Reassigning always
// resets status to PENDING, even if the slot was previously CONFIRMED — the
// new person hasn't agreed yet.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

// Look up the assignment + gate on the set's org. Returns the row and the
// acting admin, or an error response.
async function load(id: string) {
  const existing = await prisma.assignment.findUnique({
    where: { id },
    include: { set: { select: { orgId: true } } },
  });
  if (!existing) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  const admin = await requireOrgAdminFor(existing.set.orgId);
  if (!admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { existing, admin };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { userId } = await req.json();
  if (typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const loaded = await load(id);
  if ("error" in loaded) return loaded.error;
  const { existing, admin } = loaded;

  // The new person must belong to the set's org.
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: existing.set.orgId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const updated = await prisma.assignment.update({
      where: { id },
      data: { userId, status: "PENDING" },
    });
    await prisma.setHistoryEvent.create({
      data: {
        setId: existing.setId,
        role: existing.role,
        actorId: admin.user.id,
        targetUserId: userId,
        previousUserId: existing.userId,
        type: "REASSIGNED",
      },
    });
    return NextResponse.json(updated);
  } catch {
    // Unique [setId, userId, role] — that person already fills this role here.
    return NextResponse.json(
      { error: "That person is already in this role on this set." },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const loaded = await load(id);
  if ("error" in loaded) return loaded.error;
  const { existing, admin } = loaded;

  await prisma.assignment.delete({ where: { id } });
  await prisma.setHistoryEvent.create({
    data: {
      setId: existing.setId,
      role: existing.role,
      actorId: admin.user.id,
      targetUserId: existing.userId,
      type: "REMOVED",
    },
  });
  return NextResponse.json({ ok: true });
}
