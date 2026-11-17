// The open cover requests one person could take: upcoming, someone else's,
// in a role they play on the set's own team (any team's role for a team-less
// set), within the given orgs, and not already declined by them. ONE reading,
// shared by GET /api/swaps (My Sets, the navbar dot) and the access key's
// get_open_covers tool (lib/agentSnapshot.ts), so Jarvis is never offered a
// cover the app wouldn't show.
import { prisma } from "./prisma";

export async function openCoversFor(userId: string, orgIds: string[]) {
  // Roles are per-team now, so a person can cover a set only if they play its
  // role ON THAT set's team. Read the caller's per-team roles fresh from the db
  // (they change on the profile page). rolesByTeam[teamId] = their roles there;
  // anyRole = the union, used for team-less sets ("open to the whole org").
  const myTeams = await prisma.teamMember.findMany({
    where: { userId },
    select: { teamId: true, roles: true },
  });
  const rolesByTeam = new Map(myTeams.map((m) => [m.teamId, m.roles]));
  const anyRole = new Set(myTeams.flatMap((m) => m.roles));

  const swaps = await prisma.assignment.findMany({
    where: {
      status: "SWAP_REQUESTED",
      userId: { not: userId },
      set: { startsAt: { gte: new Date() }, orgId: { in: orgIds } },
      // Requests I've already said "not me" to. A decline is personal — the
      // slot stays open to everyone else — so it's filtered here rather than
      // by anything on the assignment itself.
      coverDeclines: { none: { userId } },
    },
    include: {
      set: { include: { org: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { set: { startsAt: "asc" } },
  });

  // Per-team eligibility (small N, so filter in JS): I can cover a set if I play
  // its role on its team — or on any team for a team-less set.
  return (
    swaps
      .filter((s) => {
        if (!s.set.teamId) return anyRole.has(s.role);
        return rolesByTeam.get(s.set.teamId)?.includes(s.role) ?? false;
      })
      // Surface the owner's cover note as `reason` (see ApiSwapRequest).
      .map((s) => ({ ...s, reason: s.swapReason }))
  );
}
