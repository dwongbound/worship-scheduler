// GET /api/swaps — open swap requests the current user could take:
// upcoming, someone else's, for an instrument the user plays, and within
// the user's orgs (?orgId= narrows to one — the Set Manager org filter).
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

  // Instruments can change any time on the profile page, so read them
  // fresh from the db rather than trusting a stale JWT.
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { instruments: true },
  });
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  const swaps = await prisma.assignment.findMany({
    where: {
      status: "SWAP_REQUESTED",
      userId: { not: user.id },
      role: { in: me.instruments },
      set: { startsAt: { gte: new Date() }, orgId: { in: scope } },
    },
    include: {
      set: { include: { org: { select: { id: true, name: true } } } },
      user: { select: { id: true, name: true } },
    },
    orderBy: { set: { startsAt: "asc" } },
  });

  return NextResponse.json(swaps);
}
