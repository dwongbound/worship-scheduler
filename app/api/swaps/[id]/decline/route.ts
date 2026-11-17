// POST /api/swaps/:id/decline  { note? } — say "not me" to an open cover request.
//
// A cover request is broadcast, so declining resolves nothing for anyone else:
// the slot stays SWAP_REQUESTED and the card stays on every other eligible
// player's list. What it does do is take the card off MY list (GET /api/swaps
// skips requests I've declined) and DM the owner, with my note if I left one.
//
// Eligibility is the same rule as taking it (lib/sets coverEligibility), so a
// decline can only come from someone the request actually reached — with one
// exception: `alreadyInRole` is ignored. Holding the role already is a reason
// the TAKE would collide on the unique key, not a reason you can't answer.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import type { Instrument } from "@/lib/constants";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { coverEligibility } from "@/lib/sets";
import { notifyCoverDeclined } from "@/lib/slack";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The note is optional — an empty box means "no, nothing to add", which the
  // owner's DM renders by simply leaving the sentence out.
  const body = await req.json().catch(() => ({}));
  const trimmed = typeof body?.note === "string" ? body.note.trim() : "";
  const note = trimmed === "" ? null : trimmed.slice(0, 500);

  const assignment = await prisma.assignment.findUnique({
    where: { id },
    include: { set: { select: { orgId: true, teamId: true } } },
  });
  if (!assignment) {
    return NextResponse.json(
      { error: "Swap request not found" },
      { status: 404 }
    );
  }

  // Roles are per-team, so read mine fresh the same way the take route does.
  const myTeams = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true, roles: true },
  });
  const setTeamId = assignment.set.teamId;
  const viewerOnTeam = setTeamId
    ? myTeams.some((m) => m.teamId === setTeamId)
    : true; // team-less set = open to the whole org
  const viewerRolesForSet = (
    setTeamId
      ? myTeams.find((m) => m.teamId === setTeamId)?.roles ?? []
      : myTeams.flatMap((m) => m.roles)
  ) as Instrument[];

  const eligibility = coverEligibility({
    viewerId: user.id,
    ownerId: assignment.userId,
    assignmentStatus: assignment.status,
    viewerRolesForSet,
    role: assignment.role,
    viewerOrgIds: await getMyOrgIds(user.id),
    setOrgId: assignment.set.orgId,
    setTeamId,
    viewerOnTeam,
    alreadyInRole: false, // see the header — irrelevant to declining
  });
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error },
      { status: eligibility.status }
    );
  }

  // Upsert, so changing your mind about the WORDING isn't an error — and so a
  // double-tap on a slow connection can't 500 on the unique key.
  await prisma.coverDecline.upsert({
    where: { assignmentId_userId: { assignmentId: assignment.id, userId: user.id } },
    create: { assignmentId: assignment.id, userId: user.id, note },
    update: { note },
  });

  // Non-throwing and a no-op when the org has no messaging, like every sender.
  await notifyCoverDeclined(assignment.id, user.name ?? "Someone", note);

  return NextResponse.json({ ok: true });
}
