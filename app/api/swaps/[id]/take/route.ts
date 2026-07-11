// POST /api/swaps/:id/take — take over someone's swap-requested slot.
// The assignment moves to me already CONFIRMED — taking a cover is itself the
// commitment, so there's no separate confirm step.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
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
    include: { set: { select: { orgId: true } } },
  });
  if (!assignment || assignment.status !== "SWAP_REQUESTED") {
    return NextResponse.json(
      { error: "Swap request not found" },
      { status: 404 }
    );
  }
  // Covers can only be taken by members of the set's org.
  if (!(await getMyOrgIds(user.id)).includes(assignment.set.orgId)) {
    return NextResponse.json(
      { error: "Swap request not found" },
      { status: 404 }
    );
  }
  if (assignment.userId === user.id) {
    return NextResponse.json(
      { error: "Cannot take your own swap" },
      { status: 400 }
    );
  }

  // I must actually play this instrument…
  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { instruments: true },
  });
  if (!me?.instruments.includes(assignment.role)) {
    return NextResponse.json(
      { error: "You don't play this instrument" },
      { status: 400 }
    );
  }

  // …and can't already fill THIS role on the set (holding a different role on
  // the same set is fine — a person can play more than one).
  const alreadyInRole = await prisma.assignment.findUnique({
    where: {
      setId_userId_role: {
        setId: assignment.setId,
        userId: user.id,
        role: assignment.role,
      },
    },
  });
  if (alreadyInRole) {
    return NextResponse.json(
      { error: "You already play this role on this set" },
      { status: 400 }
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
