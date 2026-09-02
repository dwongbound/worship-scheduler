// POST /api/admin/assignments — an org admin manually adds a person to a set
// in a given role. Created as PENDING (they still confirm). The org is
// derived from the set; the person must be a member of it.
//
// An optional `guestTeamId` seats them in a role BORROWED from another team
// (see lib/guestTeams.ts) — the role is then validated against that team's
// catalog rather than the set's own, since role keys only mean something
// within their team.
import { NextRequest, NextResponse } from "next/server";
import { roleLabel } from "@/lib/teamRoles";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { promoteMDIfEmpty } from "@/lib/setMd";
import { notifySetChange } from "@/lib/slack";
import { type Instrument } from "@/lib/constants";
import { getTeamCatalog } from "@/lib/teamRoleStore";

export async function POST(req: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { setId, userId, role, guestTeamId } = await req.json();
  if (
    typeof setId !== "string" ||
    typeof userId !== "string" ||
    typeof role !== "string" ||
    (guestTeamId != null && typeof guestTeamId !== "string")
  ) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { orgId: true, teamId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  // Roles are per-team, so "is this a real role" is a question about ONE team's
  // catalog — the set's own, or the guest team's when this is a borrowed seat.
  // A guest row must belong to this set, which also stops a guestTeamId from
  // another set being used to smuggle in an unrelated team's roles.
  let guestRow: { id: string; teamId: string } | null = null;
  if (guestTeamId) {
    guestRow = await prisma.setGuestTeam.findFirst({
      where: { id: guestTeamId, setId },
      select: { id: true, teamId: true },
    });
    if (!guestRow) {
      return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
    }
  }
  const catalog = await getTeamCatalog(guestRow ? guestRow.teamId : set.teamId);
  if (!catalog.some((r) => r.key === role)) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // The assignee must belong to the set's org.
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: set.orgId } },
    // The name comes along for the group-chat notice below.
    select: { id: true, user: { select: { name: true } } },
  });
  if (!membership) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  try {
    const created = await prisma.assignment.create({
      data: {
        setId,
        userId,
        role,
        guestTeamId: guestRow?.id ?? null,
        status: "PENDING",
      },
    });
    await prisma.setHistoryEvent.create({
      data: { setId, role, actorId: admin.user.id, targetUserId: userId, type: "ADDED" },
    });
    // If this set needs an MD, has none yet, and the person just added is an
    // eligible MD, make them the MD (parity with auto-schedule).
    await promoteMDIfEmpty(setId, userId);
    await notifySetChange(
      setId,
      `\u{2795} ${membership.user.name} was added on ${roleLabel(role as Instrument, catalog)}.`
    );
    return NextResponse.json(created, { status: 201 });
  } catch {
    // Unique [setId, userId, role] — the person already fills this role here.
    return NextResponse.json(
      { error: "That person is already in this role on this set." },
      { status: 400 }
    );
  }
}
