// POST /api/swaps/propose  { fromAssignmentId, toAssignmentId }
// Propose a targeted trade: my slot (from) for someone else's (to), same role.
// Freezes BOTH assignments at PENDING_SWAP and records a SwapProposal the
// recipient can accept/reject. Fails loudly on anything that would make the
// trade invalid or collide with the setId+userId+role unique key on accept.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifySwapProposed } from "@/lib/slack";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fromAssignmentId, toAssignmentId, reason } = await req.json();
  if (!fromAssignmentId || !toAssignmentId) {
    return NextResponse.json(
      { error: "fromAssignmentId and toAssignmentId are required" },
      { status: 400 }
    );
  }

  const [from, to] = await Promise.all([
    prisma.assignment.findUnique({
      where: { id: fromAssignmentId },
      include: { set: { select: { orgId: true, teamId: true } } },
    }),
    prisma.assignment.findUnique({
      where: { id: toAssignmentId },
      include: { set: { select: { orgId: true, teamId: true } } },
    }),
  ]);

  // Ownership + shape checks.
  if (!from || from.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!to) {
    return NextResponse.json({ error: "Target not found" }, { status: 404 });
  }
  if (to.userId === user.id) {
    return NextResponse.json(
      { error: "Can't swap with yourself." },
      { status: 400 }
    );
  }
  if (
    from.role !== to.role ||
    from.set.orgId !== to.set.orgId ||
    from.set.teamId !== to.set.teamId
  ) {
    return NextResponse.json(
      { error: "Swaps must be the same role on the same team." },
      { status: 400 }
    );
  }
  if (from.status === "PENDING_SWAP" || to.status === "PENDING_SWAP") {
    return NextResponse.json(
      { error: "One of these slots is already part of a pending swap." },
      { status: 409 }
    );
  }

  // No other PENDING proposal may already touch either assignment.
  const existing = await prisma.swapProposal.findFirst({
    where: {
      status: "PENDING",
      OR: [
        { fromAssignmentId: { in: [from.id, to.id] } },
        { toAssignmentId: { in: [from.id, to.id] } },
      ],
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: "One of these slots already has a pending swap." },
      { status: 409 }
    );
  }

  // Accepting swaps the users, so guard the unique key up front: neither
  // person may already hold this role on the set they'd move onto.
  const collision = await prisma.assignment.findFirst({
    where: {
      role: from.role,
      OR: [
        { setId: from.setId, userId: to.userId }, // they'd land on my set
        { setId: to.setId, userId: user.id }, // I'd land on their set
      ],
    },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: "One of you already plays this role on the other's set." },
      { status: 409 }
    );
  }

  const proposal = await prisma.$transaction(async (tx) => {
    await tx.assignment.update({
      where: { id: from.id },
      data: { status: "PENDING_SWAP" },
    });
    await tx.assignment.update({
      where: { id: to.id },
      data: { status: "PENDING_SWAP" },
    });
    // Log the proposal on the requester's set (activity feed).
    await tx.setHistoryEvent.create({
      data: {
        setId: from.setId,
        role: from.role,
        type: "SWAP_PROPOSED",
        actorId: user.id,
        targetUserId: user.id,
      },
    });
    return tx.swapProposal.create({
      data: {
        fromAssignmentId: from.id,
        toAssignmentId: to.id,
        requestedById: user.id,
        recipientId: to.userId,
        fromPrevStatus: from.status,
        toPrevStatus: to.status,
        reason:
          typeof reason === "string" && reason.trim() ? reason.trim() : null,
      },
    });
  });

  // Best-effort DM to the recipient; never blocks the response.
  await notifySwapProposed(proposal.id);

  return NextResponse.json(proposal);
}
