// POST /api/sets/:id/slack-group — open a Slack group DM among a set's assigned
// team members and post an intro message. The org is derived from the set.
//
// For the people the set is ABOUT: an org admin, or someone actually playing
// on it. It used to accept any member of the org, which let anyone browsing
// the calendar create a private channel around a roster they had nothing to
// do with and post into it. SetDetailModal disables the button on the same
// rule, but that's the affordance, not the gate — this is the gate.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor, requireOrgMemberFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { messageSetTeamOnSlack } from "@/lib/slack";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true, assignments: { select: { userId: true } } },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const member = await requireOrgMemberFor(set.orgId);
  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // On the set, or an admin of its org. The membership check above already
  // pinned the tenant, so this only has to answer "is it yours?".
  const onSet = set.assignments.some((a) => a.userId === member.user.id);
  if (!onSet && !(await requireOrgAdminFor(set.orgId))) {
    return NextResponse.json(
      { error: "Only an admin or someone on this set can message the team." },
      { status: 403 }
    );
  }

  const result = await messageSetTeamOnSlack(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  // The chat is made either way; playlistNote (when set) says why no Spotify
  // playlist link went with it, so the UI can show that instead of nothing.
  return NextResponse.json({ ok: true, playlistNote: result.playlistNote });
}
