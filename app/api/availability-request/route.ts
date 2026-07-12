// GET /api/availability-request — each of my orgs' active (most recent)
// availability request, plus whether I still need to respond to it.
// Powers the Availabilities red dot + reminder banner (dot lights if ANY
// org has an unanswered active request).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgIds = await getMyOrgIds(user.id);

  // The most recent request per org (small N — one query per org is fine),
  // joined with my response for it.
  const items = (
    await Promise.all(
      orgIds.map(async (orgId) => {
        const request = await prisma.availabilityRequest.findFirst({
          where: { orgId },
          orderBy: { createdAt: "desc" },
          include: { org: { select: { id: true, name: true } } },
        });
        if (!request) return null;
        const response = await prisma.availabilityResponse.findUnique({
          where: {
            userId_requestId: { userId: user.id, requestId: request.id },
          },
          select: { completedAt: true },
        });
        return { request, needsResponse: !response?.completedAt };
      })
    )
  ).filter((item) => item !== null);

  return NextResponse.json({
    items,
    needsResponse: items.some((i) => i.needsResponse),
  });
}
