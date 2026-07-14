// GET /api/slack/connect/callback — Slack returns here after a user authorizes.
// Exchange the code, read their member id from the OIDC userinfo, and save it on
// THIS org's membership (member ids are workspace-scoped).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
import { verifyState } from "@/lib/slackOauth";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const base = process.env.NEXTAUTH_URL ?? "";
  const back = (status: string) =>
    NextResponse.redirect(`${base}/profile?slack=${status}`);

  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return back("error");

  const parsed = verifyState(state);
  if (!parsed || parsed.purpose !== "connect") return back("error");

  // The session user must match the one who started the flow, and still belong.
  const user = await getSessionUser();
  if (!user || user.id !== parsed.userId) return back("forbidden");
  const mine = await getMyOrgIds(user.id);
  if (!mine.includes(parsed.orgId)) return back("forbidden");

  const res = await fetch("https://slack.com/api/openid.connect.token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: `${base}/api/slack/connect/callback`,
    }),
  });
  const token = await res.json().catch(() => null);
  if (!token?.ok || !token.access_token) return back("error");

  const info = await fetch("https://slack.com/api/openid.connect.userInfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  })
    .then((r) => r.json())
    .catch(() => null);
  const memberId = info?.["https://slack.com/user_id"] as string | undefined;
  if (!memberId) return back("error");

  // Guard against linking a member id from the WRONG workspace: a member id
  // only means anything in its own workspace, so it must match the one the org
  // installed its bot into. (Skipped if the org hasn't recorded a team yet.)
  const org = await prisma.org.findUnique({
    where: { id: parsed.orgId },
    select: { slackTeamId: true },
  });
  const returnedTeam = info?.["https://slack.com/team_id"] as string | undefined;
  if (org?.slackTeamId && returnedTeam && returnedTeam !== org.slackTeamId) {
    return back("wrong_workspace");
  }

  try {
    await prisma.orgMembership.update({
      where: { userId_orgId: { userId: user.id, orgId: parsed.orgId } },
      data: { slackUserId: memberId },
    });
  } catch {
    // (orgId, slackUserId) unique tripped — this Slack account is already
    // linked to a different app account in this org.
    return back("duplicate");
  }
  return back("connected");
}
