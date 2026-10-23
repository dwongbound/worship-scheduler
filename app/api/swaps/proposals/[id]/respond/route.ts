// POST /api/swaps/proposals/:id/respond
//   { action: "accept" | "reject", note?: string }
// The RECIPIENT (owner of the proposal's toAssignment) accepts or rejects a
// targeted trade.
//   accept — exchange the two slots' users; both become CONFIRMED.
//   reject — restore each slot to the status it had before the proposal, and
//            keep the optional note they typed, which leads the proposer's DM.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifySwapResolved, notifyAdminsPendingApproval } from "@/lib/slack";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action, note } = await req.json();
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  // Optional, and capped so one person can't post a wall of text into someone
  // else's DMs.
  if (note !== undefined && typeof note !== "string") {
    return NextResponse.json({ error: "Bad note" }, { status: 400 });
  }
  const trimmedNote =
    typeof note === "string" ? note.trim().slice(0, 500) : "";
  // NULL, not "": a blank or whitespace-only box means "no reason given", and
  // the DM omits the sentence entirely rather than opening with a gap.
  const declineNote = trimmedNote === "" ? null : trimmedNote;

  const proposal = await prisma.swapProposal.findUnique({
    where: { id },
    include: {
      // The proposer's name, for the admin approval DM below. Pulled in here
      // rather than looked up afterwards: this query already has to run, and
      // the accepter's own name is on the session.
      requestedBy: { select: { name: true } },
      fromAssignment: {
        include: { set: { select: { orgId: true, label: true, startsAt: true } } },
      },
      toAssignment: true,
    },
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
        data: {
          status: "REJECTED",
          respondedAt: new Date(),
          declineNote,
        },
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

  // The two slots exchange users immediately (the sets show the new people),
  // but as PENDING_APPROVAL — an admin still has to approve the trade before
  // it's final. The proposal likewise sits at PENDING_APPROVAL.
  await prisma.$transaction([
    // Recipient takes the requester's slot.
    prisma.assignment.update({
      where: { id: from.id },
      data: { userId: recipientId, status: "PENDING_APPROVAL" },
    }),
    // Requester takes the recipient's slot.
    prisma.assignment.update({
      where: { id: to.id },
      data: { userId: requesterId, status: "PENDING_APPROVAL" },
    }),
    prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "PENDING_APPROVAL", respondedAt: new Date() },
    }),
    // Activity log on both sets (actor = the accepter). REASSIGNED (not
    // SWAP_TAKEN) keeps a targeted trade distinct from an open-cover take in
    // history + the team stats.
    prisma.setHistoryEvent.create({
      data: {
        setId: from.setId,
        role: from.role,
        type: "SWAP_ACCEPTED",
        actorId: recipientId,
        targetUserId: recipientId,
        previousUserId: requesterId,
      },
    }),
    prisma.setHistoryEvent.create({
      data: {
        setId: to.setId,
        role: to.role,
        type: "SWAP_ACCEPTED",
        actorId: recipientId,
        targetUserId: requesterId,
        previousUserId: recipientId,
      },
    }),
  ]);

  // Tell the requester it was accepted, and ping the org's admins that the
  // trade now needs approval. Both no-op without Slack.
  await notifySwapResolved(proposal.id, true);
  // Who ended up in the seat the admin is being asked about: `from` is the
  // requester's old slot, which the accepter (that's us) has just moved into.
  await notifyAdminsPendingApproval(from.set.orgId, {
    kind: "swap",
    role: from.role,
    set: { label: from.set.label, startsAt: from.set.startsAt },
    taker: user.name ?? "Someone",
    previousOwner: proposal.requestedBy.name,
  });
  return NextResponse.json({ ok: true, status: "PENDING_APPROVAL" });
}
