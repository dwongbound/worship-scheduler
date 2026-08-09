// GET /api/spotify/connect?orgId= — an org admin authorizes the shared church
// Spotify account. Redirects to Spotify's consent screen; the callback stores
// the resulting refresh token on the org.
// DELETE /api/spotify/connect?orgId= — disconnect the org's Spotify account.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { authorizeUrl, disconnectOrg, isSpotifyAppConfigured } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isSpotifyAppConfigured()) {
    return NextResponse.json({ error: "Spotify app not configured" }, { status: 500 });
  }

  return NextResponse.redirect(authorizeUrl(orgId, admin.user.id));
}

export async function DELETE(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  await disconnectOrg(orgId);
  return NextResponse.json({ ok: true });
}
