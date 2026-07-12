// PATCH /api/teams/:id — an org admin updates the team's Slack channel id.
// DELETE /api/teams/:id — an org admin removes a team. Its sets and templates
// survive with teamId = null (open to the whole org) via onDelete: SetNull;
// memberships just disappear with the join rows.
// Both derive the org from the team itself, then check admin of THAT org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

// Shared guard: 404 for unknown teams, 403 for non-admins of the team's org.
async function guard(teamId: string): Promise<NextResponse | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { orgId: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(team.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await guard(id);
  if (denied) return denied;

  const { slackChannelId } = await req.json();
  if (slackChannelId !== null && typeof slackChannelId !== "string") {
    return NextResponse.json(
      { error: "slackChannelId must be a string or null" },
      { status: 400 }
    );
  }

  const team = await prisma.team.update({
    where: { id },
    // Empty/whitespace input clears the channel (turns the feature off).
    data: { slackChannelId: slackChannelId?.trim() || null },
    select: { id: true, name: true, slackChannelId: true },
  });
  return NextResponse.json(team);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const denied = await guard(id);
  if (denied) return denied;

  await prisma.team.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
