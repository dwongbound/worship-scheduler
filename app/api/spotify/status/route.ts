// GET /api/spotify/status?orgId= — whether THIS org has connected its shared
// Spotify account, so the UI can enable/disable that org's playlist actions.
// Per-org, like /api/slack/status.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isOrgSpotifyConnected } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ enabled: false }, { status: 401 });

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ enabled: false });

  return NextResponse.json({ enabled: await isOrgSpotifyConnected(orgId) });
}
