// PATCH   /api/admin/assignments/:id — reassign a slot to a different person.
// DELETE  /api/admin/assignments/:id — clear the slot.
// Admin only. Reassigning always resets status to PENDING, even if the slot
// was previously CONFIRMED — the new person hasn't agreed yet.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { userId } = await req.json();
  if (typeof userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  try {
    const updated = await prisma.assignment.update({
      where: { id },
      data: { userId, status: "PENDING" },
    });
    return NextResponse.json(updated);
  } catch {
    // Unique [setId, userId] — that person is already on this set.
    return NextResponse.json(
      { error: "That person is already on this set." },
      { status: 400 }
    );
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
  const result = await prisma.assignment.deleteMany({ where: { id } });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
