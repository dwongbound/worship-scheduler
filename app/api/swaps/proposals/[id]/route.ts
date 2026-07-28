// DELETE /api/swaps/proposals/:id — the REQUESTER withdraws a pending trade,
// restoring both slots to the status they had before it was proposed.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const proposal = await prisma.swapProposal.findUnique({ where: { id } });
  // Only the person who initiated it can cancel it.
  if (!proposal || proposal.requestedById !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (proposal.status !== "PENDING") {
    return NextResponse.json(
      { error: "This swap has already been resolved." },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.assignment.update({
      where: { id: proposal.fromAssignmentId },
      data: { status: proposal.fromPrevStatus },
    }),
    prisma.assignment.update({
      where: { id: proposal.toAssignmentId },
      data: { status: proposal.toPrevStatus },
    }),
    prisma.swapProposal.update({
      where: { id: proposal.id },
      data: { status: "CANCELED", respondedAt: new Date() },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
