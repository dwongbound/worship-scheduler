// GET /api/google-calendar/status?orgId= — for Org settings' Google Calendar
// row (org admins only): which account is connected, which calendar holds the
// sets (its NAME only — the account's other calendars are for the admin who
// connected, via /calendars) and who connected it. The connected flag alone
// also rides on /api/me, which is what /profile's add-your-email banner reads.
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
    select: {
      googleCalRefreshToken: true,
      googleCalEmail: true,
      googleCalendarName: true,
      googleCalConnectedById: true,
    },
  });
  const connectedBy = org?.googleCalConnectedById
    ? await prisma.user.findUnique({
        where: { id: org.googleCalConnectedById },
        select: { name: true },
      })
    : null;
  return NextResponse.json({
    configured: isGoogleCalendarAppConfigured(),
    connected: !!org?.googleCalRefreshToken,
    email: org?.googleCalEmail ?? null,
    calendarName: org?.googleCalendarName ?? null,
    connectedByName: connectedBy?.name ?? null,
    connectedByMe:
      !!org?.googleCalConnectedById && org.googleCalConnectedById === admin.user.id,
  });
}
