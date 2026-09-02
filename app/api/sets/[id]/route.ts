// PATCH /api/sets/:id — edit a set's notes (org admins + the set's worship
// leader, who runs it), its designated MD (org admins only), its private flag
// (org admins only), whether it requires an MD (org admins only), its team
// shape (org admins only), or its guest teams (org admins only).
// Send { notes }, { mdUserId } (null clears the MD), { isPrivate },
// { requiresMD }, { slotCapacities } (null = go back to the default shape), or
// { guestTeams } (the full replacement list — see lib/guestTeams.ts).
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
import {
  MAX_GUEST_TEAMS_PER_SET,
  validateGuestRoles,
  type GuestRoleSpec,
} from "@/lib/guestTeams";

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
  const editingGuestTeams = "guestTeams" in body;
  const editingRequiresMD = "requiresMD" in body;
  const editingGroupChatLead = "groupChatLeadDays" in body;
  const editingCapacities = "slotCapacities" in body;
  // Only a plain notes edit (not MD/privacy/requiresMD/group-chat/shape/guests)
  // needs a notes string.
  if (
    !editingMD &&
    !editingPrivate &&
    !editingGuestTeams &&
    !editingRequiresMD &&
    !editingGroupChatLead &&
    !editingCapacities &&
    typeof body.notes !== "string"
  ) {
    return NextResponse.json({ error: "notes is required" }, { status: 400 });
  }

  const set = await prisma.set.findUnique({
    where: { id },
    // teamId comes along for the guest-team edit: a set's OWN team may never
    // also be listed as a guest on it.
    select: { orgId: true, teamId: true },
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
    !editingGuestTeams &&
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

  // Guest teams: the full list, replacing whatever the set had. Each entry is
  // { teamId, roles } where roles are keys from THAT team's catalog.
  //
  // Rows are diffed rather than wiped and recreated, because assignments point
  // at SetGuestTeam.id — deleting a row a guest is standing in would blank
  // their guestTeamId (onDelete: SetNull) and silently demote them to an
  // owning-team seat. Only teams actually dropped by this edit get deleted,
  // which is the one case where losing the link is what the admin asked for.
  if (editingGuestTeams) {
    if (!Array.isArray(body.guestTeams)) {
      return NextResponse.json(
        { error: "guestTeams must be an array" },
        { status: 400 }
      );
    }
    if (body.guestTeams.length > MAX_GUEST_TEAMS_PER_SET) {
      return NextResponse.json(
        { error: `At most ${MAX_GUEST_TEAMS_PER_SET} guest teams per set` },
        { status: 400 }
      );
    }

    // Every guest must be a real team in THIS set's org (never another
    // tenant's), and must not be the set's own team — that's not a guest.
    const teamIds: string[] = [];
    for (const entry of body.guestTeams) {
      if (!entry || typeof entry.teamId !== "string") {
        return NextResponse.json({ error: "Invalid guest team" }, { status: 400 });
      }
      if (teamIds.includes(entry.teamId)) {
        return NextResponse.json(
          { error: "Duplicate guest team" },
          { status: 400 }
        );
      }
      teamIds.push(entry.teamId);
    }
    if (teamIds.includes(set.teamId ?? "")) {
      return NextResponse.json(
        { error: "A set's own team can't also be a guest on it" },
        { status: 400 }
      );
    }
    const teams = await prisma.team.findMany({
      where: { id: { in: teamIds }, orgId: set.orgId },
      select: {
        id: true,
        roles: { select: { key: true } },
      },
    });
    if (teams.length !== teamIds.length) {
      return NextResponse.json(
        { error: "Unknown team for this org" },
        { status: 400 }
      );
    }

    // Validate each team's borrowed roles against that team's own catalog.
    const cleaned: { teamId: string; roles: GuestRoleSpec[] }[] = [];
    for (const entry of body.guestTeams) {
      const catalogKeys = teams
        .find((t) => t.id === entry.teamId)!
        .roles.map((r) => r.key);
      const roles = validateGuestRoles(entry.roles, catalogKeys);
      if (!roles) {
        return NextResponse.json(
          { error: "Invalid roles for a guest team" },
          { status: 400 }
        );
      }
      cleaned.push({ teamId: entry.teamId, roles });
    }

    const existing = await prisma.setGuestTeam.findMany({
      where: { setId: id },
      select: { id: true, teamId: true },
    });
    const keep = new Set(cleaned.map((c) => c.teamId));
    await prisma.$transaction([
      prisma.setGuestTeam.deleteMany({
        where: {
          setId: id,
          teamId: { in: existing.filter((e) => !keep.has(e.teamId)).map((e) => e.teamId) },
        },
      }),
      ...cleaned.map((c) =>
        prisma.setGuestTeam.upsert({
          where: { setId_teamId: { setId: id, teamId: c.teamId } },
          create: { setId: id, teamId: c.teamId, roles: c.roles },
          update: { roles: c.roles },
        })
      ),
    ]);
    const updated = await prisma.setGuestTeam.findMany({
      where: { setId: id },
      select: { id: true, teamId: true, roles: true },
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
