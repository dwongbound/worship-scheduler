// POST /api/swaps/proposals/:id/respond  { action: "accept" | "reject" }
// The RECIPIENT (owner of the proposal's toAssignment) accepts or rejects a
// targeted trade.
//   accept — exchange the two slots' users; both become CONFIRMED.
//   reject — restore each slot to the status it had before the proposal.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifySwapResolved } from "@/lib/slack";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = await req.json();
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const proposal = await prisma.swapProposal.findUnique({
    where: { id },
    include: { fromAssignment: true, toAssignment: true },
  });
  if (!proposal || proposal.toAssignment.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (proposal.status !== "PENDING") {
    return NextResponse.json(
      { error: "This swap has already been resolved." },
      { status: 409 }
    );
  }

  const { fromAssignment: from, toAssignment: to } = proposal;
  const requesterId = proposal.requestedById; // owns `from`
  const recipientId = user.id; // owns `to`

  if (action === "reject") {
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: from.id },
        data: { status: proposal.fromPrevStatus },
      }),
      prisma.assignment.update({
        where: { id: to.id },
        data: { status: proposal.toPrevStatus },
      }),
      prisma.swapProposal.update({
        where: { id: proposal.id },
        data: { status: "REJECTED", respondedAt: new Date() },
      }),
    ]);
    await notifySwapResolved(proposal.id, false);
    return NextResponse.json({ ok: true, status: "REJECTED" });
  }

  // accept — re-check the unique-key collision (state may have moved since the
  // proposal was made), then exchange the two slots' users.
  const collision = await prisma.assignment.findFirst({
    where: {
      role: from.role,
      id: { notIn: [from.id, to.id] },
      OR: [
        { setId: from.setId, userId: recipientId },
        { setId: to.setId, userId: requesterId },
      ],
    },
    select: { id: true },
  });
  if (collision) {
    return NextResponse.json(
      { error: "One of you now already plays this role on the other's set." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    // Recipient takes the requester's slot.
    prisma.assignment.update({
      where: { id: from.id },
      data: { userId: recipientId, status: "CONFIRMED" },
    }),
    // Requester takes the recipient's slot.
    prisma.assignment.update({
      where: { id: to.id },
      data: { userId: requesterId, status: "CONFIRMED" },
    }),
    prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "ACCEPTED", respondedAt: new Date() },
    }),
    // Activity log on both sets (actor = the accepter). REASSIGNED (not
    // SWAP_TAKEN) keeps a targeted trade distinct from an open-cover take in
    // history + the team stats.
    prisma.setHistoryEvent.create({
      data: {
        setId: from.setId,
        role: from.role,
        type: "REASSIGNED",
        actorId: recipientId,
        targetUserId: recipientId,
        previousUserId: requesterId,
      },
    }),
    prisma.setHistoryEvent.create({
      data: {
        setId: to.setId,
        role: to.role,
        type: "REASSIGNED",
        actorId: recipientId,
        targetUserId: requesterId,
        previousUserId: recipientId,
      },
    }),
  ]);

  await notifySwapResolved(proposal.id, true);
  return NextResponse.json({ ok: true, status: "ACCEPTED" });
}
