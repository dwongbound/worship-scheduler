// GET /api/assignments — the current user's upcoming assignments with set
// details (?orgId= narrows to one org — the Set Manager's org filter).
// Powers the "My Sets" list on the Swaps tab.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveOrgScope } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  const assignments = await prisma.assignment.findMany({
    where: {
      userId: user.id,
      set: { startsAt: { gte: new Date() }, orgId: { in: scope } },
    },
    include: { set: { include: { org: { select: { id: true, name: true } } } } },
    orderBy: { set: { startsAt: "asc" } },
  });

  return NextResponse.json(assignments);
}
