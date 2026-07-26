// POST /api/swaps/:id/take — take over someone's swap-requested slot.
// The assignment moves to me already CONFIRMED — taking a cover is itself the
// commitment, so there's no separate confirm step.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { coverEligibility } from "@/lib/sets";
import { notifySwapTaken } from "@/lib/slack";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: {
      set: {
        select: {
          orgId: true,
          teamId: true,
          // Whether the taker is on this set's team (empty array = they're not).
          team: { select: { users: { where: { id: user.id }, select: { id: true } } } },
        },
      },
    },
  });
  if (!assignment) {
    return NextResponse.json(
      { error: "Swap request not found" },
      { status: 404 }
    );
  }

  // Gather the facts the eligibility rule needs, then decide in one place (a
  // pure, unit-tested helper — see lib/sets.ts). Holding a different role on
  // the same set is fine, so only THIS role counts as "already in role".
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { instruments: true },
  });
  const alreadyInRole = await prisma.assignment.findUnique({
    where: {
      setId_userId_role: {
        setId: assignment.setId,
        userId: user.id,
        role: assignment.role,
      },
    },
  });

  const eligibility = coverEligibility({
    viewerId: user.id,
    ownerId: assignment.userId,
    assignmentStatus: assignment.status,
    viewerInstruments: me?.instruments ?? [],
    role: assignment.role,
    viewerOrgIds: await getMyOrgIds(user.id),
    setOrgId: assignment.set.orgId,
    setTeamId: assignment.set.teamId,
    viewerOnTeam: (assignment.set.team?.users.length ?? 0) > 0,
    alreadyInRole: !!alreadyInRole,
  });
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error },
      { status: eligibility.status }
    );
  }

  // Capture the original owner before we reassign the row away from them.
  const previousOwnerId = assignment.userId;

  const updated = await prisma.assignment.update({
    where: { id: assignment.id },
    data: { userId: user.id, status: "CONFIRMED" },
  });

  await prisma.setHistoryEvent.create({
    data: {
      setId: assignment.setId,
      role: assignment.role,
      actorId: user.id,
      targetUserId: user.id,
      previousUserId: previousOwnerId,
      type: "SWAP_TAKEN",
    },
  });

  // Tell the person who gave up the slot that it's covered. Non-throwing and a
  // no-op when Slack isn't configured.
  await notifySwapTaken(updated.id, previousOwnerId, user.name ?? "Someone");

  return NextResponse.json(updated);
}
