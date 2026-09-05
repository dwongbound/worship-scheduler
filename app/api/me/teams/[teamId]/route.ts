// PUT /api/me/teams/:teamId — join a team. Idempotent: already on it = a no-op.
// DELETE /api/me/teams/:teamId — leave the team (drops my roles there too).
//
// Roles are NOT settable here. Who plays what on a team is an admin's call —
// they assign it from the Team tab (PATCH /api/admin/users/:id, `teamRoles`) —
// so this route joins you with an empty role list and never touches the roles
// of a membership that already exists. The profile page shows them read-only.
//
// Both validate that the team belongs to one of the caller's orgs, so nobody can
// join a team in an org they haven't joined.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";

// The team must exist AND sit in an org the caller belongs to.
async function assertJoinable(userId: string, teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, orgId: true },
  });
  if (!team) return null;
  const myOrgIds = await getMyOrgIds(userId);
  return myOrgIds.includes(team.orgId) ? team : null;
}

export async function PUT(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const team = await assertJoinable(user.id, teamId);
  if (!team) return NextResponse.json({ error: "Unknown team" }, { status: 404 });

  // Join with no roles; an existing membership is returned untouched. Any
  // `roles` in the body is ignored on purpose — see the note at the top.
  const member = await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: user.id } },
    create: { teamId, userId: user.id, roles: [] },
    update: {},
    select: { teamId: true, roles: true },
  });
  return NextResponse.json(member);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  // deleteMany (not delete) so leaving a team you're not on is a no-op, not a 500.
  await prisma.teamMember.deleteMany({ where: { teamId, userId: user.id } });
  return NextResponse.json({ ok: true });
}
