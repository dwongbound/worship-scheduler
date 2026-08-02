// Data behind the navbar's reminder dots + banners. Each helper is the core of
// the single-purpose endpoint it was split out of, so GET /api/notifications
// can compute every badge in ONE round trip instead of the client firing four
// parallel requests (and re-firing them on a 60s poll). The individual routes
// still exist for their other callers and now share this same logic.
import { prisma } from "./prisma";
import { getMyOrgIds, resolveOrgScope } from "./org";

// Open cover requests the user could take + targeted trades awaiting their
// response, across all their orgs — the total behind the swap dot. Only the
// count is needed here, so we COUNT rather than fetch the rows (cf. GET
// /api/swaps and /api/swaps/proposals/incoming, which return the full lists for
// the Set Manager UI; the WHERE clauses here mirror theirs).
export async function swapBadgeCount(userId: string): Promise<number> {
  const scope = await resolveOrgScope(userId, null); // all my orgs
  const now = new Date();

  // Roles are per-team, so cover eligibility (plays the role on the set's team,
  // or any team for a team-less set) can't be a single count query — fetch the
  // caller's per-team roles and the candidate rows, then count matches in JS.
  const myTeams = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true, roles: true },
  });
  const rolesByTeam = new Map(myTeams.map((m) => [m.teamId, m.roles]));
  const anyRole = new Set(myTeams.flatMap((m) => m.roles));

  const [coverCandidates, incoming] = await Promise.all([
    prisma.assignment.findMany({
      where: {
        status: "SWAP_REQUESTED",
        userId: { not: userId },
        set: { startsAt: { gte: now }, orgId: { in: scope } },
      },
      select: { role: true, set: { select: { teamId: true } } },
    }),
    prisma.swapProposal.count({
      where: {
        status: "PENDING",
        toAssignment: {
          userId,
          set: { orgId: { in: scope }, startsAt: { gte: now } },
        },
      },
    }),
  ]);

  const covers = coverCandidates.filter((a) =>
    a.set.teamId
      ? rolesByTeam.get(a.set.teamId)?.includes(a.role) ?? false
      : anyRole.has(a.role)
  ).length;
  return covers + incoming;
}

// Each of my orgs' active (most recent) availability request + whether I still
// owe it a response. Drives the Availabilities dot + reminder banner (the dot
// lights if ANY org has an unanswered active request).
export async function availabilityStatus(userId: string) {
  const orgIds = await getMyOrgIds(userId);

  // The most recent request per org (small N — one query per org is fine),
  // joined with my response for it.
  const items = (
    await Promise.all(
      orgIds.map(async (orgId) => {
        const request = await prisma.availabilityRequest.findFirst({
          where: { orgId },
          orderBy: { createdAt: "desc" },
          include: { org: { select: { id: true, name: true } } },
        });
        if (!request) return null;
        const response = await prisma.availabilityResponse.findUnique({
          where: { userId_requestId: { userId, requestId: request.id } },
          select: { completedAt: true },
        });
        return { request, needsResponse: !response?.completedAt };
      })
    )
  ).filter((item) => item !== null);

  return {
    items,
    needsResponse: items.some((i) => i.needsResponse),
  };
}

// The org's members who aren't on any team in THAT org yet — the Team tab's
// reminder dot + banner (admins only; the caller checks admin rights). Roles are
// per-team now, so anyone off every team in this org can't be scheduled at all;
// the banner nudges the admin to add them to a team (where they/the admin then
// pick roles). Team membership is per-org, so `none` is filtered to this org.
export async function teamlessMembers(
  orgId: string
): Promise<{ id: string; name: string; username: string }[]> {
  return prisma.user.findMany({
    where: {
      memberships: { some: { orgId } },
      teamMembers: { none: { team: { orgId } } },
    },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
}
