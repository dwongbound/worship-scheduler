// GET /api/admin/users — the org's members: their per-team roles + whether
// they've finished entering availability (the "scheduling completed" log).
// Org comes from the x-org-id header; NOTHING cross-org leaks out of here —
// team chips, responses, and the isAdmin flag are all scoped to that org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { memberships: { some: { orgId: admin.orgId } } },
    select: {
      id: true,
      name: true,
      username: true,
      isMD: true,
      // The caller's org's membership row — its isAdmin is what the Team
      // page's checkbox reads/toggles; slackUserId (set once the person links
      // Slack in THIS org) drives the Team page's "connected" badge.
      memberships: {
        where: { orgId: admin.orgId },
        select: { isAdmin: true, slackUserId: true, alwaysInGroupChats: true },
      },
      // Team memberships within this org, each with the roles the person plays
      // on that team — gate the assignment dropdowns + Team page role editing.
      teamMembers: {
        where: { team: { orgId: admin.orgId } },
        select: {
          roles: true,
          active: true,
          team: { select: { id: true, name: true } },
        },
      },
      // Per-request completion (this org's requests only) — drives the
      // status panel's TimeRange dropdown.
      availabilityResponses: {
        where: { request: { orgId: admin.orgId } },
        select: { requestId: true, completedAt: true, edited: true },
      },
      // The assignment dropdowns (SetDetailModal) use these to flag people who
      // are unavailable at a given set's time. Busy blocks are global to the
      // person by design (they apply to every org).
      unavailability: {
        select: {
          type: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          startDate: true,
          endDate: true,
          requestId: true,
          note: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Flatten the single-org membership row into the isAdmin boolean the client
  // has always consumed, plus slackConnected (Slack linked in THIS org).
  return NextResponse.json(
    users.map(({ memberships, teamMembers, ...u }) => ({
      ...u,
      isAdmin: memberships[0]?.isAdmin ?? false,
      slackConnected: memberships[0]?.slackUserId != null,
      slackUserId: memberships[0]?.slackUserId ?? null,
      alwaysInGroupChats: memberships[0]?.alwaysInGroupChats ?? false,
      // Flatten each team membership to { id, name, roles } — the shape the
      // Team page + assignment dropdowns consume.
      teams: teamMembers.map((tm) => ({
        id: tm.team.id,
        name: tm.team.name,
        roles: tm.roles,
        active: tm.active,
      })),
    }))
  );
}
