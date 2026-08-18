// GET /api/swaps — open swap requests the current user could take:
// upcoming, someone else's, for an instrument the user plays, within the
// user's orgs (?orgId= narrows to one — the Set Manager org filter), and on
// the set's own team (a team-less set is open to the whole org).
// Also powers the navbar red dot (it just checks the count, all orgs).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveOrgScope } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Roles are per-team now, so a person can cover a set only if they play its
  // role ON THAT set's team. Read the caller's per-team roles fresh from the db
  // (they change on the profile page). rolesByTeam[teamId] = their roles there;
  // anyRole = the union, used for team-less sets ("open to the whole org").
  const myTeams = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true, roles: true },
  });
  const rolesByTeam = new Map(myTeams.map((m) => [m.teamId, m.roles]));
  const anyRole = new Set(myTeams.flatMap((m) => m.roles));

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  const swaps = await prisma.assignment.findMany({
    where: {
      status: "SWAP_REQUESTED",
      userId: { not: user.id },
      set: { startsAt: { gte: new Date() }, orgId: { in: scope } },
    },
    include: {
      set: { include: { org: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { set: { startsAt: "asc" } },
  });

  // Per-team eligibility (small N, so filter in JS): I can cover a set if I play
  // its role on its team — or on any team for a team-less set.
  const eligible = swaps
    .filter((s) =>
      s.set.teamId
        ? rolesByTeam.get(s.set.teamId)?.includes(s.role) ?? false
        : anyRole.has(s.role)
    )
    // Surface the owner's cover note as `reason` (see ApiSwapRequest).
    .map((s) => ({ ...s, reason: s.swapReason }));

  return NextResponse.json(eligible);
}
