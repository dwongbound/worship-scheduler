// GET /api/slack/status?orgId= — whether THIS org's Slack bot is connected, so
// the UI can hide that org's Slack actions when it isn't. Slack is per-org now,
// so a global "is Slack on" flag would be misleading (the bot for org A can't
// message org B).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isOrgSlackConnected } from "@/lib/slack";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ enabled: false }, { status: 401 });

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ enabled: false });

  return NextResponse.json({ enabled: await isOrgSlackConnected(orgId) });
}
