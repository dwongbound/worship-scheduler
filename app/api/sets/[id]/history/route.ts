// GET /api/sets/:id/history — a set's activity log (SetDetailModal's History
// section): additions/removals/reassignments by admins, and self-service
// confirms/swaps by the assigned users. Newest first.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // Only members of the set's org can read its history.
  const set = await prisma.set.findUnique({ where: { id }, select: { orgId: true } });
  if (!set || !(await getMyOrgIds(user.id)).includes(set.orgId)) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }

  const events = await prisma.setHistoryEvent.findMany({
    where: { setId: id },
    include: {
      actor: { select: { id: true, name: true } },
      targetUser: { select: { id: true, name: true } },
      previousUser: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(events);
}
