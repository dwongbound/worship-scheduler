// POST /api/teams/:id/slack-summary — an org admin posts the next 7 days of
// this team's sets (with each person's role) to the team's Slack channel.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { sendTeamWeeklySummary } from "@/lib/slack";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const team = await prisma.team.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(team.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await sendTeamWeeklySummary(id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
