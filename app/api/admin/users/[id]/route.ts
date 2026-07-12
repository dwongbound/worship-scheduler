// PATCH /api/admin/users/:id — an org admin edits a member's admin flag
// (for THIS org), musical-director flag, instruments, and this-org team
// memberships. Org comes from the x-org-id header; the target must be a
// member of that org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { SLOT_CAPACITIES } from "@/lib/constants";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  // The target user must belong to the admin's org (also our 404 for bad ids).
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: id, orgId: admin.orgId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Only apply the fields that were actually sent, and validate them.
  // isMD/instruments live on the User (global to the person); isAdmin lives
  // on the org membership; team edits touch only THIS org's teams.
  const data: Record<string, unknown> = {};

  if (typeof body.isMD === "boolean") {
    data.isMD = body.isMD;
  }

  if (Array.isArray(body.instruments)) {
    const validInstruments = Object.keys(SLOT_CAPACITIES);
    data.instruments = body.instruments.filter((i: string) =>
      validInstruments.includes(i)
    );
  }

  if (Array.isArray(body.teamIds)) {
    const teamIds = body.teamIds.filter((t: unknown) => typeof t === "string");
    // Every referenced team must belong to this org…
    const validCount = await prisma.team.count({
      where: { id: { in: teamIds }, orgId: admin.orgId },
    });
    if (validCount !== teamIds.length) {
      return NextResponse.json({ error: "Unknown team" }, { status: 400 });
    }
    // …and we must NOT use `teams: { set }` here: that would wipe the user's
    // team memberships in OTHER orgs. Disconnect only this org's teams, then
    // connect the new list.
    const currentOrgTeams = await prisma.team.findMany({
      where: { orgId: admin.orgId, users: { some: { id } } },
      select: { id: true },
    });
    data.teams = {
      disconnect: currentOrgTeams.map((t) => ({ id: t.id })),
      connect: teamIds.map((teamId: string) => ({ id: teamId })),
    };
  }

  const setsAdmin = typeof body.isAdmin === "boolean";
  if (Object.keys(data).length === 0 && !setsAdmin) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [updated] = await prisma.$transaction([
    prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        isMD: true,
        instruments: true,
        memberships: {
          where: { orgId: admin.orgId },
          select: { isAdmin: true },
        },
        teams: {
          where: { orgId: admin.orgId },
          select: { id: true, name: true },
        },
        availabilityResponses: {
          where: { request: { orgId: admin.orgId } },
          select: { requestId: true, completedAt: true, edited: true },
        },
      },
    }),
    ...(setsAdmin
      ? [
          prisma.orgMembership.update({
            where: { userId_orgId: { userId: id, orgId: admin.orgId } },
            data: { isAdmin: body.isAdmin },
          }),
        ]
      : []),
  ]);

  const { memberships, ...fields } = updated;
  return NextResponse.json({
    ...fields,
    // Reflect the just-written value (the user.update read may predate the
    // membership write inside the same transaction).
    isAdmin: setsAdmin ? body.isAdmin : memberships[0]?.isAdmin ?? false,
  });
}
