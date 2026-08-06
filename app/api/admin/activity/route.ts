// GET /api/admin/activity?orgId=&type=&teamId= — the org's activity log across
// all its sets: covers, swaps, approvals, admin add/remove/reassign, and
// self-service confirms. Newest first. Admin-only (x-org-id header).
//   type   — optional SetHistoryEventType to filter to (e.g. SWAP_TAKEN).
//   teamId — optional: only events on that team's sets.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { ALL_HISTORY_TYPES } from "@/lib/constants";

const MAX = 300;

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const typeParam = req.nextUrl.searchParams.get("type");
  const teamId = req.nextUrl.searchParams.get("teamId");
  const type =
    typeParam && (ALL_HISTORY_TYPES as string[]).includes(typeParam)
      ? (typeParam as (typeof ALL_HISTORY_TYPES)[number])
      : undefined;

  const events = await prisma.setHistoryEvent.findMany({
    where: {
      set: { orgId: admin.orgId, ...(teamId ? { teamId } : {}) },
      ...(type ? { type } : {}),
    },
    include: {
      actor: { select: { id: true, name: true } },
      targetUser: { select: { id: true, name: true } },
      previousUser: { select: { id: true, name: true } },
      set: {
        select: {
          id: true,
          label: true,
          startsAt: true,
          team: { select: { name: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: MAX,
  });

  return NextResponse.json(
    events.map((e) => ({
      id: e.id,
      type: e.type,
      role: e.role,
      actor: e.actor,
      targetUser: e.targetUser,
      previousUser: e.previousUser,
      createdAt: e.createdAt,
      set: { id: e.set.id, label: e.set.label, startsAt: e.set.startsAt },
      teamName: e.set.team?.name ?? null,
    }))
  );
}
