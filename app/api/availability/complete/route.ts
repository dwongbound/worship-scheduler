// POST /api/availability/complete — toggle "I'm done scheduling".
// Sets scheduleCompletedAt to now, or clears it if already set.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: { scheduleCompletedAt: true },
  });

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { scheduleCompletedAt: me?.scheduleCompletedAt ? null : new Date() },
    select: { scheduleCompletedAt: true },
  });

  return NextResponse.json(updated);
}
