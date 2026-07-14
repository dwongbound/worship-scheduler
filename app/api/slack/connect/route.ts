// GET /api/slack/connect?orgId= — start Flow A: a user captures their own Slack
// member id in one org's workspace ("Sign in with Slack", used for LINKING, not
// login). Prefills the workspace so they skip Slack's picker.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { signState, SLACK_USER_SCOPES } from "@/lib/slackOauth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  const mine = await getMyOrgIds(user.id);
  if (!mine.includes(orgId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const base = process.env.NEXTAUTH_URL;
  if (!clientId || !base) {
    return NextResponse.json({ error: "Slack app not configured" }, { status: 500 });
  }

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { slackTeamId: true },
  });

  const state = signState({ orgId, userId: user.id, purpose: "connect" });
  const url = new URL("https://slack.com/openid/connect/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_USER_SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${base}/api/slack/connect/callback`);
  url.searchParams.set("state", state);
  if (org?.slackTeamId) url.searchParams.set("team", org.slackTeamId);
  return NextResponse.redirect(url.toString());
}
