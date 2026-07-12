// DELETE /api/admin/sets/:id/roles/:role[?assignmentId=…] — remove ONE slot
// of a role from ONE set (admin only). Triggered by the "✕" beside a slot row
// in the set detail modal.
//
// Lowers the role's capacity by one in the set's slotCapacities override
// (other sets keep their own shape). When the removed slot was filled, pass
// its assignmentId: the assignment is deleted in the same transaction and
// logged as REMOVED. A role whose capacity reaches 0 with nobody left in it
// disappears from the roster.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  SLOT_CAPACITIES,
  resolveCapacities,
  type SlotCapacityMap,
} from "@/lib/constants";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; role: string }> }
) {
  const { id, role } = await params;
  if (!(role in SLOT_CAPACITIES)) {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }
  const instrument = role as keyof typeof SLOT_CAPACITIES;

  const set = await prisma.set.findUnique({
    where: { id },
    select: { slotCapacities: true, orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The slot being removed may be a filled one — its assignment goes with it.
  const assignmentId = req.nextUrl.searchParams.get("assignmentId");
  let assignment = null;
  if (assignmentId) {
    // Scoped to this set + role so a stale/foreign id can't delete elsewhere.
    assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, setId: id, role: instrument },
    });
    if (!assignment) {
      return NextResponse.json(
        { error: "Assignment not found on this set/role" },
        { status: 404 }
      );
    }
  }

  // One fewer slot for this role on this set (never below 0).
  const stored = set.slotCapacities as SlotCapacityMap | null;
  const capacities: SlotCapacityMap = {
    ...(stored ?? {}),
    [instrument]: Math.max(0, resolveCapacities(stored)[instrument] - 1),
  };

  await prisma.$transaction([
    ...(assignment
      ? [
          prisma.assignment.delete({ where: { id: assignment.id } }),
          prisma.setHistoryEvent.create({
            data: {
              setId: id,
              role: instrument,
              actorId: admin.user.id,
              targetUserId: assignment.userId,
              type: "REMOVED" as const,
            },
          }),
        ]
      : []),
    prisma.set.update({ where: { id }, data: { slotCapacities: capacities } }),
  ]);

  return NextResponse.json({ ok: true });
}
