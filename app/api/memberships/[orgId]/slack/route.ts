// PUT /api/memberships/[orgId]/slack — a user manually sets or clears their own
// Slack member id for one org (the fallback to the Connect OAuth flow). Body:
// { slackUserId: string | null }.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { isOrgSlackConnected } from "@/lib/slack";
import { prisma } from "@/lib/prisma";

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = await params;

  const mine = await getMyOrgIds(user.id);
  if (!mine.includes(orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = body.slackUserId;
  const slackUserId =
    typeof raw === "string" && raw.trim() ? raw.trim() : null;

  // A member id only points somewhere once the org's bot is installed, so
  // there's nothing to link to before then — block SETTING one (clearing is
  // always fine). The profile UI already hides the field; this backs it up.
  if (slackUserId && !(await isOrgSlackConnected(orgId))) {
    return NextResponse.json(
      { error: "Connect Slack for this org before adding a member ID." },
      { status: 400 }
    );
  }

  try {
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: user.id, orgId } },
      data: { slackUserId },
    });
    return NextResponse.json({ slackUserId });
  } catch {
    return NextResponse.json(
      { error: "That Slack ID is already linked in this org." },
      { status: 400 }
    );
  }
}
