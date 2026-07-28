// GET /api/swaps/proposals/incoming?orgId=  — pending targeted trades awaiting
// MY response (I own the toAssignment). These render in the Cover Requests
// area with Accept / Reject, and also power the navbar swap dot.
//   • the set I'd GIVE UP (mine / toAssignment) and the set I'd RECEIVE
//     (theirs / fromAssignment), each with date + role,
//   • who proposed it.
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

  const setSelect = {
    select: {
      id: true,
      label: true,
      startsAt: true,
      org: { select: { id: true, name: true } },
    },
  } as const;

  const proposals = await prisma.swapProposal.findMany({
    where: {
      status: "PENDING",
      toAssignment: {
        userId: user.id,
        set: { orgId: { in: scope }, startsAt: { gte: new Date() } },
      },
    },
    include: {
      requestedBy: { select: { id: true, name: true } },
      // The slot I'd give up.
      toAssignment: { select: { role: true, set: setSelect } },
      // The slot I'd receive.
      fromAssignment: { select: { role: true, set: setSelect } },
    },
    orderBy: { createdAt: "desc" },
  });

  const items = proposals.map((p) => ({
    id: p.id,
    role: p.toAssignment.role,
    requestedBy: p.requestedBy,
    giveUp: p.toAssignment.set, // my current set
    receive: p.fromAssignment.set, // their set I'd take
  }));

  return NextResponse.json(items);
}
