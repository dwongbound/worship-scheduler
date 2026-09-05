// GET /api/sets/:id/history — a set's activity log: additions/removals/
// reassignments by admins, self-service confirms/swaps by the assigned users,
// and set-level setlist/notes edits. Newest first.
//
// `?types=A,B` narrows it to those event types. The set detail modal passes
// `types=NOTES_CHANGED`, because its History section is about the notes and
// nothing else; without the filter the client would have to download a set's
// whole roster history to show a handful of lines. Unknown names are ignored,
// and an all-unknown list falls back to everything rather than silently
// answering empty.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  ALL_HISTORY_TYPES,
  type SetHistoryEventType,
} from "@/lib/constants";

export async function GET(
  req: NextRequest,
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

  // Narrow to the requested types, keeping only names the enum actually has.
  const requested = (req.nextUrl.searchParams.get("types") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t): t is SetHistoryEventType =>
      (ALL_HISTORY_TYPES as string[]).includes(t)
    );

  const events = await prisma.setHistoryEvent.findMany({
    where: {
      setId: id,
      ...(requested.length > 0 ? { type: { in: requested } } : {}),
    },
    include: {
      actor: { select: { id: true, name: true } },
      targetUser: { select: { id: true, name: true } },
      previousUser: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(events);
}
