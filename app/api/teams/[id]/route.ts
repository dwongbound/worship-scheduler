// PATCH /api/teams/:id — an org admin updates the team's Slack channel id
// and/or its auto group-chat lead time (groupChatLeadDays; null = off).
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

  const body = await req.json();
  const data: { slackChannelId?: string | null; groupChatLeadDays?: number | null } =
    {};

  if ("slackChannelId" in body) {
    if (body.slackChannelId !== null && typeof body.slackChannelId !== "string") {
      return NextResponse.json(
        { error: "slackChannelId must be a string or null" },
        { status: 400 }
      );
    }
    // Empty/whitespace input clears the channel (turns the feature off).
    data.slackChannelId = body.slackChannelId?.trim() || null;
  }

  if ("groupChatLeadDays" in body) {
    const v = body.groupChatLeadDays;
    // null = off; otherwise an integer number of days in [1, 30].
    if (
      v !== null &&
      (!Number.isInteger(v) || v < 1 || v > 30)
    ) {
      return NextResponse.json(
        { error: "groupChatLeadDays must be null or an integer in 1–30" },
        { status: 400 }
      );
    }
    data.groupChatLeadDays = v;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const team = await prisma.team.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      slackChannelId: true,
      groupChatLeadDays: true,
    },
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
