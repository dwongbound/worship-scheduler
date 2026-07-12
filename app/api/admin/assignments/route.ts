// POST /api/admin/assignments — an org admin manually adds a person to a set
// in a given role. Created as PENDING (they still confirm). The org is
// derived from the set; the person must be a member of it.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { SLOT_CAPACITIES } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { setId, userId, role } = await req.json();
  if (
    typeof setId !== "string" ||
    typeof userId !== "string" ||
    !Object.keys(SLOT_CAPACITIES).includes(role)
  ) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The assignee must belong to the set's org.
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: set.orgId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  try {
    const created = await prisma.assignment.create({
      data: { setId, userId, role, status: "PENDING" },
    });
    await prisma.setHistoryEvent.create({
      data: { setId, role, actorId: admin.user.id, targetUserId: userId, type: "ADDED" },
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    // Unique [setId, userId, role] — the person already fills this role here.
    return NextResponse.json(
      { error: "That person is already in this role on this set." },
      { status: 400 }
    );
  }
}
