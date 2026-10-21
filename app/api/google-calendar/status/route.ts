// GET /api/google-calendar/status?orgId= — for Org settings' Google Calendar
// row (org admins only): which account is connected, and which members have no
// email on file, so get no invites. The connected flag alone also rides on
// /api/me; this adds the admin-only name list.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { isGoogleCalendarAppConfigured } from "@/lib/googleCalendar";

export async function GET(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { googleCalRefreshToken: true, googleCalEmail: true },
  });
  const missing = await prisma.orgMembership.findMany({
    where: { orgId, user: { email: null } },
    select: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });
  return NextResponse.json({
    configured: isGoogleCalendarAppConfigured(),
    connected: !!org?.googleCalRefreshToken,
    email: org?.googleCalEmail ?? null,
    missingEmail: missing.map((m) => m.user.name),
  });
}
