// GET /api/slack/install/callback — Slack returns here after an admin approves
// the bot install. Exchange the code for the workspace's bot token, encrypt it
// onto the Org, then best-effort auto-link members by email.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { verifyState } from "@/lib/slackOauth";
import { encryptSecret } from "@/lib/crypto";
import { autoPopulateSlackIds } from "@/lib/slack";
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

  // Resolve member ids by email so most people never have to click Connect.
  await autoPopulateSlackIds(parsed.orgId).catch(() => {});

  return back("installed");
}
