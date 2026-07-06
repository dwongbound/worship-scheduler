// POST /api/assignments/confirm-all — confirm every PENDING assignment of
// the current user in one shot (the "toggle all" convenience).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await prisma.assignment.updateMany({
    where: {
      userId: user.id,
      status: "PENDING",
      set: { startsAt: { gte: new Date() } }, // only upcoming sets
    },
    data: { status: "CONFIRMED" },
  });

  return NextResponse.json({ confirmed: result.count });
}
