// GET /api/teams — the caller's orgs' teams (?orgId= narrows; the set forms
// need them). POST /api/teams — an org admin creates a team in the org named
// by the x-org-id header (the Team page's "Add team" form).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdmin, resolveOrgScope } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { TEAM_ROLE_FIELDS, seedTeamRoles } from "@/lib/teamRoleStore";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  // Oldest-first so the first (usually broadest) team is the forms' default.
  const teams = await prisma.team.findMany({
    where: { orgId: { in: scope } },
    select: {
      id: true,
      name: true,
      orgId: true,
      slackChannelId: true,
      // Its role catalog — the set forms, role pickers and rosters all read
      // roles from the team now, never from a fixed list.
      roles: { select: TEAM_ROLE_FIELDS, orderBy: { order: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(teams);
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name } = await req.json();
  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  try {
    const team = await prisma.team.create({
      data: { name: name.trim(), orgId: admin.orgId },
      select: { id: true, name: true, orgId: true },
    });
    // Every team needs a catalog from the moment it exists — it starts with
    // the built-in roles, which the admin then edits to taste.
    await seedTeamRoles(team.id);
    return NextResponse.json(team, { status: 201 });
  } catch {
    // The per-org unique constraint on name is the only way this create fails.
    return NextResponse.json(
      { error: "A team with that name already exists" },
      { status: 409 }
    );
  }
}
