// PUT /api/me/teams/:teamId — join a team (if not already on it) and/or set MY
// roles on it. Body: { roles: string[] } of TeamRole keys. Roles are per-team,
// and users manage their own — with one exception: a role marked ADMIN-ONLY is
// an admin's to grant (the same rule MD has always had), so this route ignores
// any attempt to add one and preserves whatever an admin already gave you.
// DELETE /api/me/teams/:teamId — leave the team (drops my roles there too).
//
// Both validate that the team belongs to one of the caller's orgs, so nobody can
// join a team in an org they haven't joined.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { getTeamCatalog } from "@/lib/teamRoleStore";

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
  req: NextRequest,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { teamId } = await params;
  const team = await assertJoinable(user.id, teamId);
  if (!team) return NextResponse.json({ error: "Unknown team" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const catalog = await getTeamCatalog(teamId);
  // Only roles this team actually offers, and only the ones I'm allowed to pick
  // for myself.
  const selfServe = new Set(
    catalog.filter((r) => !r.adminOnly).map((r) => r.key)
  );
  const asked: string[] = Array.isArray(body.roles)
    ? body.roles.filter((r: unknown) => typeof r === "string")
    : [];
  const roles = [...new Set(asked.filter((r) => selfServe.has(r)))];

  // Admin-only roles I already hold are kept: this route can neither grant them
  // nor take them away, so they pass through untouched.
  const existing = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: user.id } },
    select: { roles: true },
  });
  const adminGranted = (existing?.roles ?? []).filter(
    (r) => !selfServe.has(r) && catalog.some((c) => c.key === r)
  );
  roles.push(...adminGranted);

  // Upsert: joining creates the row (roles default to []), editing overwrites.
  const member = await prisma.teamMember.upsert({
    where: { teamId_userId: { teamId, userId: user.id } },
    create: { teamId, userId: user.id, roles },
    update: { roles },
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
