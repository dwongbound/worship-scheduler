// POST /api/availability/complete — toggle "I'm done scheduling" for a
// specific request. The row is kept once created (never deleted) so we can
// remember it was edited: first submit sets completedAt; unsubmit clears it;
// re-submit sets completedAt again and flips `edited`. Body: { requestId }.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId } = await req.json();
  if (typeof requestId !== "string") {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }

  const key = { userId_requestId: { userId: user.id, requestId } };
  const existing = await prisma.availabilityResponse.findUnique({
    where: key,
    select: { completedAt: true },
  });

  // First time → create it, submitted.
  if (!existing) {
    const created = await prisma.availabilityResponse.create({
      data: { userId: user.id, requestId, completedAt: new Date() },
      select: { completedAt: true, edited: true },
    });
    return NextResponse.json(created);
  }

  // Currently submitted → un-submit (keep the row, clear completedAt).
  if (existing.completedAt) {
    const updated = await prisma.availabilityResponse.update({
      where: key,
      data: { completedAt: null },
      select: { completedAt: true, edited: true },
    });
    return NextResponse.json(updated);
  }

  // Was un-submitted → re-submit, and mark it edited.
  const updated = await prisma.availabilityResponse.update({
    where: key,
    data: { completedAt: new Date(), edited: true },
    select: { completedAt: true, edited: true },
  });
  return NextResponse.json(updated);
}
