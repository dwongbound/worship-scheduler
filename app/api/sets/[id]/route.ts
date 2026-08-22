// PATCH /api/sets/:id — edit a set's notes (org admins + the set's worship
// leader, who runs it), its designated MD (org admins only), its private flag
// (org admins only), its choir opt-in flag (org admins only), whether it
// requires an MD (org admins only), or its team shape (org admins only).
// Send { notes }, { mdUserId } (null clears the MD), { isPrivate },
// { choirEnabled }, { requiresMD }, or { slotCapacities } (null = go back to
// the default shape).
// DELETE /api/sets/:id — an org admin removes a set entirely (its assignments
// cascade). Used by the "Delete set" button in the set detail modal.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
// Value import (not `import type`) — Prisma.DbNull is a runtime sentinel.
import { Prisma } from "@/lib/generated/prisma/client";
import { isValidMD } from "@/lib/md";
import { parseGroupChatLeadDays, validateSlotCapacities } from "@/lib/constants";

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
  const editingPrivate = "isPrivate" in body;
  const editingChoir = "choirEnabled" in body;
  const editingRequiresMD = "requiresMD" in body;
  const editingGroupChatLead = "groupChatLeadDays" in body;
  const editingCapacities = "slotCapacities" in body;
  // Only a plain notes edit (not MD/privacy/choir/requiresMD/group-chat/shape)
  // needs a notes string.
  if (
    !editingMD &&
    !editingPrivate &&
    !editingChoir &&
    !editingRequiresMD &&
    !editingGroupChatLead &&
    !editingCapacities &&
    typeof body.notes !== "string"
  ) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  // Permission: MD and privacy edits are admin-only; notes may also be edited
  // by the set's assigned worship leader.
  const admin = await requireOrgAdminFor(set.orgId);
  let allowed = !!admin;
  if (
    !allowed &&
    !editingMD &&
    !editingPrivate &&
    !editingChoir &&
    !editingRequiresMD &&
    !editingGroupChatLead &&
    !editingCapacities
  ) {
    const leaderSlot = await prisma.assignment.findFirst({
      where: { setId: id, userId: user.id, role: "WORSHIP_LEADER" },
    });
    allowed = !!leaderSlot;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (editingRequiresMD) {
    if (typeof body.requiresMD !== "boolean") {
      return NextResponse.json(
        { error: "requiresMD must be a boolean" },
        { status: 400 }
      );
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { requiresMD: body.requiresMD },
    });
    return NextResponse.json(updated);
  }

  if (editingCapacities) {
    // The set's own team shape. null = clear the override and fall back to the
    // global default (Prisma.DbNull writes a real SQL NULL into the Json
    // column; a bare `null` would store the JSON literal `null` instead).
    // Lowering a role below the people already standing in it is allowed — the
    // roster keeps showing them, it just stops offering new slots — so nobody
    // is silently dropped by a shape edit.
    if (body.slotCapacities === null) {
      const updated = await prisma.set.update({
        where: { id },
        data: { slotCapacities: Prisma.DbNull },
      });
      return NextResponse.json(updated);
    }
    const capacities = validateSlotCapacities(body.slotCapacities);
    if (!capacities) {
      return NextResponse.json(
        { error: "Invalid slot capacities" },
        { status: 400 }
      );
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { slotCapacities: capacities },
    });
    return NextResponse.json(updated);
  }

  if (editingGroupChatLead) {
    // null = off; a number is normalized to a valid 1–30 day count (out-of-range
    // → off). Admin-only, guarded above.
    if (body.groupChatLeadDays !== null && typeof body.groupChatLeadDays !== "number") {
      return NextResponse.json(
        { error: "groupChatLeadDays must be a number or null" },
        { status: 400 }
      );
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { groupChatLeadDays: parseGroupChatLeadDays(body.groupChatLeadDays) },
    });
    return NextResponse.json(updated);
  }

  if (editingChoir) {
    if (typeof body.choirEnabled !== "boolean") {
      return NextResponse.json(
        { error: "choirEnabled must be a boolean" },
        { status: 400 }
      );
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { choirEnabled: body.choirEnabled },
    });
    return NextResponse.json(updated);
  }

  if (editingPrivate) {
    if (typeof body.isPrivate !== "boolean") {
      return NextResponse.json(
        { error: "isPrivate must be a boolean" },
        { status: 400 }
      );
    }
    const updated = await prisma.set.update({
      where: { id },
      data: { isPrivate: body.isPrivate },
    });
    return NextResponse.json(updated);
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
