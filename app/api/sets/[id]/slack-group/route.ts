// POST /api/sets/:id/slack-group — open a Slack group DM among a set's assigned
// team members and post an intro message. Any MEMBER of the set's org can start
// it (not just admins) — anyone on the team may want to kick off the group
// chat. The org is derived from the set.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgMemberFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { messageSetTeamOnSlack } from "@/lib/slack";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const member = await requireOrgMemberFor(set.orgId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await messageSetTeamOnSlack(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
