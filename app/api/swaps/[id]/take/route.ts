// POST /api/swaps/:id/take — take over someone's swap-requested slot.
// The assignment moves to me with status PENDING (I still confirm it).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
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
  });
  if (!assignment || assignment.status !== "SWAP_REQUESTED") {
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

  // …and can't already be on the set in another slot.
  const alreadyOnSet = await prisma.assignment.findUnique({
    where: { setId_userId: { setId: assignment.setId, userId: user.id } },
  });
  if (alreadyOnSet) {
    return NextResponse.json(
      { error: "You're already on this set" },
      { status: 400 }
    );
  }

  // Capture the original owner before we reassign the row away from them.
  const previousOwnerId = assignment.userId;

  const updated = await prisma.assignment.update({
    where: { id: assignment.id },
    data: { userId: user.id, status: "PENDING" },
  });

  // Tell the person who gave up the slot that it's covered. Non-throwing and a
  // no-op when Slack isn't configured.
  await notifySwapTaken(updated.id, previousOwnerId, user.name ?? "Someone");

  return NextResponse.json(updated);
}
