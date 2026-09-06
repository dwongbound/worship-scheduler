// PATCH /api/admin/users/:id — an org admin edits a member's display name,
// admin flag (for THIS org), musical-director flag, this-org team
// memberships, that member's per-team roles + per-team active flag, and the
// per-org "always in group chats" flag. Org comes from the x-org-id header;
// the target must be a member of that org.
// DELETE /api/admin/users/:id — an org admin removes a member from THIS org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { getTeamCatalog } from "@/lib/teamRoleStore";
import { isOrgSlackConnected } from "@/lib/slack";

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

  // Only apply the fields that were actually sent, and validate them. isMD
  // lives on the User; isAdmin/alwaysInGroupChats on the org membership; team
  // membership + per-team roles on TeamMember. All team edits touch only THIS
  // org's teams. We run the writes below imperatively (not one $transaction)
  // because the TeamMember reconciliation depends on reads.

  // The display name is global to the person (a User field, like isMD), not
  // per-org: they're one human, and every org they serve in should see the
  // correction. Rejected blank — the name is what every roster renders.
  if (typeof body.name === "string") {
    const name = body.name.trim().replace(/\s+/g, " ");
    if (!name) {
      return NextResponse.json({ error: "Name is required." }, { status: 400 });
    }
    await prisma.user.update({ where: { id }, data: { name } });
  }

  if (typeof body.isMD === "boolean") {
    await prisma.user.update({ where: { id }, data: { isMD: body.isMD } });
  }

  // Full membership list for THIS org: create missing TeamMembers (roles [])
  // and delete removed ones, leaving other orgs' memberships untouched.
  if (Array.isArray(body.teamIds)) {
    const teamIds = body.teamIds.filter((t: unknown) => typeof t === "string");
    const validCount = await prisma.team.count({
      where: { id: { in: teamIds }, orgId: admin.orgId },
    });
    if (validCount !== teamIds.length) {
      return NextResponse.json({ error: "Unknown team" }, { status: 400 });
    }
    const current = await prisma.teamMember.findMany({
      where: { userId: id, team: { orgId: admin.orgId } },
      select: { teamId: true },
    });
    const currentIds = new Set(current.map((m) => m.teamId));
    const toAdd = teamIds.filter((t: string) => !currentIds.has(t));
    const toRemove = [...currentIds].filter((t) => !teamIds.includes(t));
    if (toRemove.length > 0) {
      await prisma.teamMember.deleteMany({
        where: { userId: id, teamId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await prisma.teamMember.createMany({
        data: toAdd.map((teamId: string) => ({ userId: id, teamId, roles: [] })),
      });
    }
  }

  // Set the member's roles on one or more of this org's teams (upserts, so it
  // also joins a team the person wasn't on). Shape: [{ teamId, roles }].
  if (Array.isArray(body.teamRoles)) {
    for (const entry of body.teamRoles) {
      if (!entry || typeof entry.teamId !== "string") continue;
      const team = await prisma.team.findFirst({
        where: { id: entry.teamId, orgId: admin.orgId },
        select: { id: true },
      });
      if (!team) {
        return NextResponse.json({ error: "Unknown team" }, { status: 400 });
      }
      // Valid roles are whatever THIS team's catalog offers — including its
      // admin-only ones, since an admin is exactly who may grant those.
      const catalog = await getTeamCatalog(entry.teamId);
      const offered = new Set(catalog.map((r) => r.key));
      const roles = Array.isArray(entry.roles)
        ? entry.roles.filter((r: string) => offered.has(r))
        : [];
      await prisma.teamMember.upsert({
        where: { teamId_userId: { teamId: entry.teamId, userId: id } },
        create: { teamId: entry.teamId, userId: id, roles },
        update: { roles },
      });
    }
  }

  // Flip a member's per-team "active" flag: [{ teamId, active }]. Inactive
  // people keep the membership (and their roles + history) but drop out of the
  // auto-scheduler and read as "(inactive)" in the pick lists. Only updates an
  // EXISTING membership — you can't activate someone onto a team they're not on.
  if (Array.isArray(body.teamActive)) {
    for (const entry of body.teamActive) {
      if (!entry || typeof entry.teamId !== "string") continue;
      if (typeof entry.active !== "boolean") continue;
      const team = await prisma.team.findFirst({
        where: { id: entry.teamId, orgId: admin.orgId },
        select: { id: true },
      });
      if (!team) {
        return NextResponse.json({ error: "Unknown team" }, { status: 400 });
      }
      await prisma.teamMember.updateMany({
        where: { teamId: entry.teamId, userId: id },
        data: { active: entry.active },
      });
    }
  }

  // isAdmin, alwaysInGroupChats, and the Slack member id all live on the org
  // membership. slackUserId lets an admin set/clear it for a person who can't
  // (or won't) run the Slack Connect flow themselves; "" clears it.
  const membershipData: {
    isAdmin?: boolean;
    alwaysInGroupChats?: boolean;
    slackUserId?: string | null;
  } = {};
  if (typeof body.isAdmin === "boolean") membershipData.isAdmin = body.isAdmin;
  if (typeof body.alwaysInGroupChats === "boolean") {
    membershipData.alwaysInGroupChats = body.alwaysInGroupChats;
  }
  if (typeof body.slackUserId === "string" || body.slackUserId === null) {
    const next =
      typeof body.slackUserId === "string" && body.slackUserId.trim()
        ? body.slackUserId.trim()
        : null;
    // A member id only means something once the org's bot is installed — the
    // id belongs to that specific workspace, and it's what we'd DM through.
    // After connecting we auto-resolve ids by email, so manual entry is just a
    // fallback; block SETTING one before Slack exists (clearing stays allowed).
    if (next && !(await isOrgSlackConnected(admin.orgId))) {
      return NextResponse.json(
        { error: "Connect Slack for this org before adding member IDs." },
        { status: 400 }
      );
    }
    membershipData.slackUserId = next;
  }
  if (Object.keys(membershipData).length > 0) {
    try {
      await prisma.orgMembership.update({
        where: { userId_orgId: { userId: id, orgId: admin.orgId } },
        data: membershipData,
      });
    } catch {
      // The only expected failure is the per-org unique Slack id constraint.
      return NextResponse.json(
        { error: "That Slack ID is already linked in this org." },
        { status: 400 }
      );
    }
  }

  // Re-read the just-written state for this org.
  const updated = await prisma.user.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      name: true,
      isMD: true,
      memberships: {
        where: { orgId: admin.orgId },
        select: { isAdmin: true, alwaysInGroupChats: true, slackUserId: true },
      },
      teamMembers: {
        where: { team: { orgId: admin.orgId } },
        select: {
          roles: true,
          active: true,
          team: { select: { id: true, name: true } },
        },
      },
      availabilityResponses: {
        where: { request: { orgId: admin.orgId } },
        select: { requestId: true, completedAt: true, edited: true },
      },
    },
  });

  const { memberships, teamMembers, ...fields } = updated;
  return NextResponse.json({
    ...fields,
    isAdmin: memberships[0]?.isAdmin ?? false,
    alwaysInGroupChats: memberships[0]?.alwaysInGroupChats ?? false,
    slackConnected: memberships[0]?.slackUserId != null,
    slackUserId: memberships[0]?.slackUserId ?? null,
    teams: teamMembers.map((tm) => ({
      id: tm.team.id,
      name: tm.team.name,
      roles: tm.roles,
      active: tm.active,
    })),
  });
}

/**
 * DELETE /api/admin/users/:id — remove a member from the admin's org.
 *
 * This unwinds them from everything FORWARD-LOOKING while leaving the record of
 * what they already did intact:
 *   • their upcoming assignments in this org are deleted (those slots re-open),
 *     and any swap proposals on them cascade away with them;
 *   • past assignments stay, so rosters, serve counts, and the set history keep
 *     reading correctly;
 *   • SetHistoryEvent rows are never touched — they point at the User, which
 *     still exists;
 *   • they're dropped from this org's teams, so the scheduler can't seat them;
 *   • they lose the org membership itself (admin flag, Slack link, and all).
 *
 * The User row itself survives: a person can belong to several orgs, and this
 * is one org's door, not the account's.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // No removing yourself — an org would be one click away from having no admin
  // at all, with nobody left who could undo it.
  if (id === admin.user.id) {
    return NextResponse.json(
      { error: "You can't remove yourself from the org." },
      { status: 400 }
    );
  }

  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: id, orgId: admin.orgId } },
    select: { id: true },
  });
  if (!membership) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const now = new Date();
  await prisma.$transaction([
    // Upcoming sets only — a set that already happened keeps its roster.
    prisma.assignment.deleteMany({
      where: {
        userId: id,
        set: { orgId: admin.orgId, startsAt: { gte: now } },
      },
    }),
    // Stop them being this set's MD going forward (the FK is SetNull, but that
    // only fires on deleting the User, which we don't do here).
    prisma.set.updateMany({
      where: { orgId: admin.orgId, mdUserId: id, startsAt: { gte: now } },
      data: { mdUserId: null },
    }),
    prisma.teamMember.deleteMany({
      where: { userId: id, team: { orgId: admin.orgId } },
    }),
    // Their answers to this org's availability requests: they're no longer on
    // the hook for any of them.
    prisma.availabilityResponse.deleteMany({
      where: { userId: id, request: { orgId: admin.orgId } },
    }),
    prisma.orgMembership.delete({ where: { id: membership.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
