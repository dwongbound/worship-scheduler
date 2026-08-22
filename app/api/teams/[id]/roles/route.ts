// GET /api/teams/:id/roles  — this team's role catalog (any member of the org).
// PUT /api/teams/:id/roles  — an org admin replaces it wholesale.
//
// The PUT body is the full ordered list: [{ key?, label, defaultCount,
// adminOnly }]. An existing role sends its `key` back so a rename keeps every
// slot pointing at it; a new role omits the key and gets one derived from its
// name. Anything missing from the list is a DELETE — and a role is only
// deletable once nobody holds it on an upcoming set (see below).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { getMyOrgIds } from "@/lib/org";
import { TEAM_ROLE_FIELDS } from "@/lib/teamRoleStore";
import { orderedRoles, roleLabel, validateCatalog } from "@/lib/teamRoles";
import { formatDay } from "@/lib/dates";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const team = await prisma.team.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  // Any member of the team's org may read the catalog — the profile role
  // picker and every set roster need it.
  const myOrgs = await getMyOrgIds(user.id);
  if (!myOrgs.includes(team.orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const roles = await prisma.teamRole.findMany({
    where: { teamId: id },
    select: TEAM_ROLE_FIELDS,
    orderBy: { order: "asc" },
  });
  return NextResponse.json(orderedRoles(roles));
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const team = await prisma.team.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(team.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = validateCatalog(body?.roles);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const next = parsed.roles;
  const nextKeys = new Set(next.map((r) => r.key));

  const current = await prisma.teamRole.findMany({
    where: { teamId: id },
    select: TEAM_ROLE_FIELDS,
  });
  const removed = current.filter((r) => !nextKeys.has(r.key));

  // ── The delete guard ──────────────────────────────────────────────────
  // A role can't vanish while people are standing in it on sets that haven't
  // happened yet — those slots would be orphaned and the people silently
  // un-booked. Past sets are fine: their rosters are history and keep reading
  // correctly through the label fallback (lib/teamRoles.ts roleLabel).
  if (removed.length > 0) {
    const blocking = await prisma.assignment.findMany({
      where: {
        role: { in: removed.map((r) => r.key) },
        set: { teamId: id, startsAt: { gte: new Date() } },
      },
      select: {
        role: true,
        user: { select: { name: true } },
        set: { select: { label: true, startsAt: true } },
      },
      orderBy: { set: { startsAt: "asc" } },
      take: 20,
    });
    if (blocking.length > 0) {
      const names = [...new Set(removed.map((r) => roleLabel(r.key, current)))];
      return NextResponse.json(
        {
          error: `Can't remove ${names.join(", ")} yet — ${blocking.length} upcoming ${
            blocking.length === 1 ? "slot is" : "slots are"
          } still filled. Clear them first.`,
          // The editor lists these so the admin knows exactly where to go.
          blocking: blocking.map((a) => ({
            role: roleLabel(a.role, current),
            user: a.user.name,
            set: a.set.label ?? "Worship Set",
            date: formatDay(a.set.startsAt),
          })),
        },
        { status: 409 }
      );
    }
  }

  // ── Apply ─────────────────────────────────────────────────────────────
  // Upsert every submitted role (rename + re-count + reorder in one go), drop
  // the rest, and strip the dropped keys from members' role lists so nobody is
  // left "playing" a role the team no longer has.
  await prisma.$transaction([
    ...next.map((role) =>
      prisma.teamRole.upsert({
        where: { teamId_key: { teamId: id, key: role.key } },
        create: { ...role, teamId: id },
        update: {
          label: role.label,
          defaultCount: role.defaultCount,
          adminOnly: role.adminOnly,
          order: role.order,
        },
      })
    ),
    prisma.teamRole.deleteMany({
      where: { teamId: id, key: { notIn: [...nextKeys] } },
    }),
  ]);

  if (removed.length > 0) {
    const gone = new Set(removed.map((r) => r.key));
    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      select: { id: true, roles: true },
    });
    await Promise.all(
      members
        .filter((m) => m.roles.some((r) => gone.has(r)))
        .map((m) =>
          prisma.teamMember.update({
            where: { id: m.id },
            data: { roles: m.roles.filter((r) => !gone.has(r)) },
          })
        )
    );
  }

  const saved = await prisma.teamRole.findMany({
    where: { teamId: id },
    select: TEAM_ROLE_FIELDS,
    orderBy: { order: "asc" },
  });
  return NextResponse.json(orderedRoles(saved));
}
