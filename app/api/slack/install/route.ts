// GET /api/slack/install?orgId= — start Flow B: an org admin adds the bot to
// their Slack workspace. Redirects to Slack's "Add to Workspace" consent; the
// callback stores the resulting per-org bot token.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { signState, SLACK_BOT_SCOPES } from "@/lib/slackOauth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const clientId = process.env.SLACK_CLIENT_ID;
  const base = process.env.NEXTAUTH_URL;
  if (!clientId || !base) {
    return NextResponse.json({ error: "Slack app not configured" }, { status: 500 });
  }

  const state = signState({ orgId, userId: admin.user.id, purpose: "install" });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES);
  url.searchParams.set("redirect_uri", `${base}/api/slack/install/callback`);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}

// DELETE /api/slack/install?orgId= — disconnect an org's Slack: drop the stored
// bot token + workspace info so the bot stops messaging that org. Members' own
// linked ids are left as-is (harmless without a bot; valid again on reconnect).
export async function DELETE(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await prisma.org.update({
    where: { id: orgId },
    data: {
      slackBotToken: null,
      slackTeamId: null,
      slackTeamName: null,
      slackBotUserId: null,
    },
  });
  return NextResponse.json({ ok: true });
}
