// GET /api/slack/install/callback — Slack returns here after an admin approves
// the bot install. Exchange the code for the workspace's bot token, encrypt it
// onto the Org. Linking people to their Slack accounts is NOT done here: it's
// the "Sync team members" button in Org settings (POST /api/slack/sync), because
// a serial email lookup per person outlives this request's time budget in any
// org big enough to matter — and failing halfway through a redirect handler is
// invisible to the admin who pressed the button.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { verifyState } from "@/lib/slackOauth";
import { encryptSecret } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const base = process.env.NEXTAUTH_URL ?? "";
  const back = (status: string) =>
    NextResponse.redirect(`${base}/calendar?slack=${status}`);

  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return back("error");

  const parsed = verifyState(state);
  if (!parsed || parsed.purpose !== "install") return back("error");

  // Re-check admin against the db — never trust the signed state alone.
  const admin = await requireOrgAdminFor(parsed.orgId);
  if (!admin || admin.user.id !== parsed.userId) return back("forbidden");

  const res = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.SLACK_CLIENT_ID ?? "",
      client_secret: process.env.SLACK_CLIENT_SECRET ?? "",
      code,
      redirect_uri: `${base}/api/slack/install/callback`,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok || !data.access_token) return back("error");

  await prisma.org.update({
    where: { id: parsed.orgId },
    data: {
      slackBotToken: encryptSecret(data.access_token),
      slackTeamId: data.team?.id ?? null,
      slackTeamName: data.team?.name ?? null,
      slackBotUserId: data.bot_user_id ?? null,
    },
  });

  return back("installed");
}
