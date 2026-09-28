// POST /api/availability/complete — toggle "I'm done scheduling" for a
// specific request. The row is kept once created (never deleted) so we can
// remember it was edited: first submit sets completedAt; unsubmit clears it;
// re-submit sets completedAt again and flips `edited`.
// Body: { requestId, note? } — `note` is the optional free-text the submit
// modal collects. OMITTING it leaves whatever note is stored alone (that's how
// un-submitting, which sends no note, keeps it); sending "" clears it.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Long enough for "away the first two weekends, and I can only do mornings
// after that", short enough that the status panel can render it whole.
const MAX_NOTE = 500;

const SELECT = { completedAt: true, edited: true, note: true } as const;

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { requestId, note } = await req.json();
  if (typeof requestId !== "string") {
    return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
  }
  if (note !== undefined && typeof note !== "string") {
    return NextResponse.json({ error: "Invalid note" }, { status: 400 });
  }
  if (typeof note === "string" && note.length > MAX_NOTE) {
    return NextResponse.json(
      { error: `Keep the note under ${MAX_NOTE} characters.` },
      { status: 400 }
    );
  }
  // A note only reaches `data` when one was sent — `undefined` tells prisma to
  // leave the column as it is. Blank (or whitespace) clears it.
  const noteData =
    note === undefined ? {} : { note: note.trim() ? note.trim() : null };

  const key = { userId_requestId: { userId: user.id, requestId } };
  const existing = await prisma.availabilityResponse.findUnique({
    where: key,
    select: { completedAt: true },
  });

  // First time → create it, submitted.
  if (!existing) {
    const created = await prisma.availabilityResponse.create({
      data: {
        userId: user.id,
        requestId,
        completedAt: new Date(),
        ...noteData,
      },
      select: SELECT,
    });
    return NextResponse.json(created);
  }

  // Currently submitted → un-submit (keep the row, clear completedAt).
  if (existing.completedAt) {
    const updated = await prisma.availabilityResponse.update({
      where: key,
      data: { completedAt: null, ...noteData },
      select: SELECT,
    });
    return NextResponse.json(updated);
  }

  // Was un-submitted → re-submit, and mark it edited.
  const updated = await prisma.availabilityResponse.update({
    where: key,
    data: { completedAt: new Date(), edited: true, ...noteData },
    select: SELECT,
  });
  return NextResponse.json(updated);
}
