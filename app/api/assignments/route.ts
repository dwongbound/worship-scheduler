// GET /api/assignments — the current user's upcoming assignments with set
// details. Powers the "My Sets" list on the Swaps tab.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignments = await prisma.assignment.findMany({
    where: { userId: user.id, set: { startsAt: { gte: new Date() } } },
    include: { set: true },
    orderBy: { set: { startsAt: "asc" } },
  });

  return NextResponse.json(assignments);
}
