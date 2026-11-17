// GET /api/google-calendar/connect?orgId= — an org admin authorizes the shared
// church Google account. Redirects to Google's consent screen; the callback
// stores the refresh token, makes the org's calendar and starts watching it.
// DELETE /api/google-calendar/connect?orgId= — disconnect it.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import {
  authorizeUrl,
  disconnectOrg,
  isGoogleCalendarAppConfigured,
} from "@/lib/googleCalendar";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (!isGoogleCalendarAppConfigured()) {
    return NextResponse.json({ error: "Google Calendar not configured" }, { status: 500 });
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
