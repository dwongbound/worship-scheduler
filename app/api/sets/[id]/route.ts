// PATCH /api/sets/:id — edit a set's notes (org admins + the set's worship
// leader, who runs it), its designated MD (org admins only), its private flag
// (org admins only), whether it requires an MD (org admins only), its team
// shape (org admins only), or its guest teams (org admins only).
// Send { notes }, { mdUserId } (null clears the MD), { isPrivate },
// { requiresMD }, { slotCapacities } (null = go back to the default shape), or
// { guestTeams } (the full replacement list — see lib/guestTeams.ts).
//
// The plain columns (notes / isPrivate / requiresMD / slotCapacities /
// groupChatLeadDays) may be sent TOGETHER and are applied in one update — the
// set detail modal stages its edits and commits them in a single click.
// { mdUserId } and { guestTeams } each stay a request of their own: the MD is
// validated against the set's final roster, and guest teams answer with the
// resulting rows rather than the set.
//
// A notes edit that actually changes the text also writes a NOTES_CHANGED
// history event — the one thing the set detail modal's History section shows.
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
import { describeNotesChange } from "@/lib/setNotes";
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
    // also be listed as a guest on it. notes is the `before` half of the notes
    // history diff below.
    select: { orgId: true, teamId: true, notes: true },
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

  // Guest teams: the full list, replacing whatever the set had. Each entry is
  // { teamId, roles } where roles are keys from THAT team's catalog.
  //
  // Rows are diffed rather than wiped and recreated, because assignments point
  // at SetGuestTeam.id — deleting a row a guest is standing in would blank
  // their guestTeamId (onDelete: SetNull) and silently demote them to an
  // owning-team seat, in a role the host team may not even have. So only teams
  // actually dropped by this edit are deleted, and their borrowed SEATS are
  // deleted with them: "this team isn't lending to us any more" means those
  // people are off the set, not quietly moved onto our own roster.
  //
  // The editor won't even let you untick a team that still has people seated
  // (GuestTeamsModal disables it), so in practice this is the backstop for a
  // direct API call — but SetNull is a silent, data-corrupting default and the
  // route shouldn't rely on the UI to avoid it.
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
    const dropped = existing.filter((e) => !keep.has(e.teamId));
    await prisma.$transaction([
      // The seats first: once the row is gone the link is null and there'd be
      // no way to tell which assignments were borrowed from it.
      prisma.assignment.deleteMany({
        where: { setId: id, guestTeamId: { in: dropped.map((e) => e.id) } },
      }),
      prisma.setGuestTeam.deleteMany({
        where: { setId: id, teamId: { in: dropped.map((e) => e.teamId) } },
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

  // ── The plain columns ────────────────────────────────────────────────
  // Everything left is an ordinary field on the Set row, so any combination of
  // them travels in ONE request and lands in ONE update. The detail modal saves
  // several at a time (it stages edits and commits them together), and five
  // sequential round trips for one click was five times the latency for no
  // reason. Guest teams and the MD stay separate above: one returns a different
  // shape, the other has to be validated against the final roster.
  const data: Prisma.SetUpdateInput = {};

  if (editingRequiresMD) {
    if (typeof body.requiresMD !== "boolean") {
      return NextResponse.json(
        { error: "requiresMD must be a boolean" },
        { status: 400 }
      );
    }
    data.requiresMD = body.requiresMD;
  }

  if (editingCapacities) {
    // The set's own team shape. null = clear the override and fall back to the
    // team default (Prisma.DbNull writes a real SQL NULL into the Json column;
    // a bare `null` would store the JSON literal `null` instead).
    // Lowering a role below the people already standing in it is allowed — the
    // roster keeps showing them, it just stops offering new slots — so nobody
    // is silently dropped by a shape edit.
    if (body.slotCapacities === null) {
      data.slotCapacities = Prisma.DbNull;
    } else {
      const capacities = validateSlotCapacities(body.slotCapacities);
      if (!capacities) {
        return NextResponse.json(
          { error: "Invalid slot capacities" },
          { status: 400 }
        );
      }
      data.slotCapacities = capacities;
    }
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
    data.groupChatLeadDays = parseGroupChatLeadDays(body.groupChatLeadDays);
  }

  if (editingPrivate) {
    if (typeof body.isPrivate !== "boolean") {
      return NextResponse.json(
        { error: "isPrivate must be a boolean" },
        { status: 400 }
      );
    }
    data.isPrivate = body.isPrivate;
  }

  // Notes are the one field a non-admin (the set's worship leader) may edit,
  // and the only one that's required when nothing else was sent — the guard at
  // the top of the route already rejected a body with neither.
  if (typeof body.notes === "string") {
    data.notes = body.notes.trim() || null;
  }

  const updated = await prisma.set.update({ where: { id }, data });

  // Log a real notes edit. This is the ONLY thing the set detail modal's
  // History section shows, so it's written here rather than left to the generic
  // roster logging — and only when the text actually changed, since the modal
  // stages every field together and saves them in one click (an untouched notes
  // box rides along with every other edit).
  if (typeof body.notes === "string") {
    const change = describeNotesChange(set.notes, data.notes as string | null);
    if (change) {
      await prisma.setHistoryEvent.create({
        data: {
          setId: id,
          type: "NOTES_CHANGED",
          actorId: user.id,
          detail: change,
        },
      });
    }
  }

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
