// GET /api/slack/status?orgId= — whether THIS org's Slack bot is connected, so
// the UI can hide that org's Slack actions when it isn't. Slack is per-org now,
// so a global "is Slack on" flag would be misleading (the bot for org A can't
// message org B). Returns `enabled` (can send — dry-run counts) and `installed`
// (a real workspace is connected — dry-run does NOT count).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isOrgMessagingConnected, isOrgMessagingInstalled } from "@/lib/orgIntegration";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ enabled: false }, { status: 401 });

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ enabled: false, installed: false });

  // Two different questions, and callers want different ones:
  //   enabled   — can this org send right now? (true for everyone in dry-run,
  //               which is what lets a dev instance exercise the send paths)
  //   installed — is a real workspace connected? The one to ask about anything
  //               workspace-scoped, like a member id.
  const [enabled, installed] = await Promise.all([
    isOrgMessagingConnected(orgId),
    isOrgMessagingInstalled(orgId),
  ]);
  return NextResponse.json({ enabled, installed });
}
