// GET /api/availability-request — the active (most recent) availability
// request, plus whether the current user still needs to respond to it.
// Powers the Availabilities red dot + reminder banner + the schedule page.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [request, me] = await Promise.all([
    prisma.availabilityRequest.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { scheduleCompletedAt: true },
    }),
  ]);

  // The user needs to respond if there's a request and they haven't marked
  // their availability complete since it was made.
  const needsResponse =
    !!request &&
    (!me?.scheduleCompletedAt || me.scheduleCompletedAt < request.createdAt);

  return NextResponse.json({ request, needsResponse });
}
