// GET /api/notifications[?orgId=] — every navbar reminder badge in one request:
// the swap dot count, availability status, whether the profile still needs
// roles, and (for the named admin org) its team-less members. Replaces the four
// separate fetches the navbar used to fire in parallel and re-poll.
//
// `orgId` scopes the team-less list to the org the admin tabs are pointed at;
// it's returned only when the caller actually administers that org.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  availabilityStatus,
  swapBadgeCount,
  teamlessMembers,
} from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Roles are per-team: the "finish your profile" dot lights until the user has
  // picked at least one role on some team.
  const hasAnyRole = await prisma.teamMember.findFirst({
    where: { userId: user.id, roles: { isEmpty: false } },
    select: { id: true },
  });

  // Team-less members are admin-only and org-scoped: compute them only when the
  // request names an org AND the caller administers it.
  const orgId = req.nextUrl.searchParams.get("orgId");
  const teamlessPromise = (async () => {
    if (!orgId) return [];
    const membership = await prisma.orgMembership.findUnique({
      where: { userId_orgId: { userId: user.id, orgId } },
      select: { isAdmin: true },
    });
    return membership?.isAdmin ? teamlessMembers(orgId) : [];
  })();

  const [swapCount, availability, teamless] = await Promise.all([
    swapBadgeCount(user.id),
    availabilityStatus(user.id),
    teamlessPromise,
  ]);

  return NextResponse.json({
    swapCount,
    availability,
    needsRoles: !hasAnyRole,
    teamless,
  });
}
