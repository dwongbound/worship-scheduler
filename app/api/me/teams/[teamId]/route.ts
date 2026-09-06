// DELETE /api/me/teams/:teamId — leave the team (drops my roles there too).
//
// ADMIN-ONLY, and the only self-service left here. Who is on a team is an org
// admin's call, managed from the Team tab (PATCH /api/admin/users/:id,
// `teamIds`) — that's where an admin adds ANYONE to a team, themselves
// included. There is deliberately no PUT: nobody joins a team by acting on
// their own account, because a roster with two ways in is a roster nobody
// owns. Leaving stays because it's an admin acting on their own membership,
// and they can put themselves back from the Team tab.
//
// Roles aren't settable here either. What you play on a team is likewise the
// admin's call (PATCH /api/admin/users/:id, `teamRoles`); the profile page
// shows them read-only.
//
// This also validates that the team belongs to one of the caller's orgs, so an
// admin of org A can't touch a team in org B.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds, requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

// The team must exist, sit in an org the caller belongs to, and the caller must
// be an admin OF THAT ORG. Membership is checked before adminship so a team in
// someone else's org stays a 404 (they shouldn't learn the id exists) while a
// plain member of the right org gets an honest 403.
async function assertManageable(
  userId: string,
  teamId: string
): Promise<{ status: number; error: string } | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { orgId: true },
  });
  const myOrgIds = await getMyOrgIds(userId);
  if (!team || !myOrgIds.includes(team.orgId)) {
    return { status: 404, error: "Unknown team" };
  }
  // Re-checked in the db (super-admins pass), so revoking admin takes effect
  // immediately rather than at the next sign-in.
  const admin = await requireOrgAdminFor(team.orgId);
  if (!admin) {
    return { status: 403, error: "Only an org admin can change team membership" };
  }
  return null;
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const denied = await assertManageable(user.id, teamId);
  if (denied) {
    return NextResponse.json({ error: denied.error }, { status: denied.status });
  }

  // deleteMany (not delete) so leaving a team you're not on is a no-op, not a 500.
  await prisma.teamMember.deleteMany({ where: { teamId, userId: user.id } });
  return NextResponse.json({ ok: true });
}
