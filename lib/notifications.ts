// Data behind the navbar's reminder dots + banners. Each helper is the core of
// the single-purpose endpoint it was split out of, so GET /api/notifications
// can compute every badge in ONE round trip instead of the client firing four
// parallel requests (and re-firing them on a 60s poll). The individual routes
// still exist for their other callers and now share this same logic.
import { prisma } from "./prisma";
import { getMyOrgIds, resolveOrgScope } from "./org";
import { ROLE_ORDER, type Instrument } from "./constants";

// Open cover requests the user could take + targeted trades awaiting their
// response, across all their orgs — the total behind the swap dot. Only the
// count is needed here, so we COUNT rather than fetch the rows (cf. GET
// /api/swaps and /api/swaps/proposals/incoming, which return the full lists for
// the Set Manager UI; the WHERE clauses here mirror theirs).
export async function swapBadgeCount(
  userId: string,
  instruments: Instrument[]
): Promise<number> {
  const scope = await resolveOrgScope(userId, null); // all my orgs
  const now = new Date();
  const [covers, incoming] = await Promise.all([
    prisma.assignment.count({
      where: {
        status: "SWAP_REQUESTED",
        userId: { not: userId },
        role: { in: instruments },
        set: {
          startsAt: { gte: now },
          orgId: { in: scope },
          // Team-scoped: only the set's team can cover it (null team = whole org).
          OR: [{ teamId: null }, { team: { users: { some: { id: userId } } } }],
        },
      },
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
// reminder dot + banner (admins only; the caller checks admin rights). Team
// membership is per-org, so `none` is filtered to this org to avoid counting a
// user who is teamed elsewhere as covered here.
//
// Only people who list a BAND role (any instrument except choir) are flagged:
// a band role can only be scheduled on the person's team, so being teamless
// blocks them. Choir-only members are skipped — choir isn't team-scoped, so
// they can join any set's choir without a team. People who haven't picked any
// role yet are also skipped: they must choose a role before the team even
// matters. Hence `hasSome: ROLE_ORDER` (the band roles) rather than "any user".
export async function teamlessMembers(
  orgId: string
): Promise<{ id: string; name: string; username: string }[]> {
  return prisma.user.findMany({
    where: {
      memberships: { some: { orgId } },
      teams: { none: { orgId } },
      instruments: { hasSome: ROLE_ORDER },
    },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });
}
