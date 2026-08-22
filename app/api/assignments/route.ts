// GET /api/assignments — the current user's upcoming assignments with set
// details (?orgId= narrows to one org — the My Sets org filter).
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

  // Attach the pending targeted-swap (if any) for PENDING_SWAP rows, so the UI
  // can offer "Cancel swap" (requester) or point the recipient at their Cover
  // Requests. isRequester = I initiated it (I own the proposal's fromAssignment).
  const swapIds = assignments
    .filter((a) => a.status === "PENDING_SWAP")
    .map((a) => a.id);
  const proposals = swapIds.length
    ? await prisma.swapProposal.findMany({
        where: {
          status: "PENDING",
          OR: [
            { fromAssignmentId: { in: swapIds } },
            { toAssignmentId: { in: swapIds } },
          ],
        },
        select: { id: true, fromAssignmentId: true, toAssignmentId: true },
      })
    : [];
  const swapByAssignment = new Map<
    string,
    { proposalId: string; isRequester: boolean }
  >();
  for (const p of proposals) {
    swapByAssignment.set(p.fromAssignmentId, {
      proposalId: p.id,
      isRequester: true,
    });
    swapByAssignment.set(p.toAssignmentId, {
      proposalId: p.id,
      isRequester: false,
    });
  }

  return NextResponse.json(
    assignments.map((a) => ({
      ...a,
      pendingSwap: swapByAssignment.get(a.id) ?? null,
    }))
  );
}
