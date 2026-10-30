// GET /api/google-calendar/my-calendars — this person's OWN Google calendars,
// for /profile's "send my invites to" picker.
//
// Google puts an invite on the default calendar of whatever address it was
// sent to, and an attendee can't move an invited event afterwards — so the
// only way to choose where your sets land is to choose the address, and a
// calendar's own address is what this lists (lib/calendarEvent.ts
// inviteAddress). Reading that list needs the person's own permission. The
// picker asks for the calendar list only (non-sensitive, so no "unverified
// app" screen); "Import from Google Calendar" adds read-only events on its own
// consent, and an import permission already covers the picker.
//
// `?connect=1` IS the trip to Google and nothing else — it reads no calendars
// and lands back on /profile?gcalPicker=…, the way the import's own consent
// route does. `{ needsConsent: true }` on the plain GET means there is no
// usable remembered permission yet, so the page offers that trip.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isGoogleCalendarAppConfigured } from "@/lib/googleCalendar";
import {
  CALENDAR_LIST_SCOPE,
  importAuthorizeUrl,
  listImportCalendars,
} from "@/lib/googleAvailability";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isGoogleCalendarAppConfigured()) {
    return NextResponse.json({ error: "Google Calendar not configured" }, { status: 500 });
  }

  if (req.nextUrl.searchParams.get("connect")) {
    // login_hint skips Google's account picker for the many people who signed
    // in with Google in the first place.
    const me = await prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    return NextResponse.redirect(importAuthorizeUrl(user.id, null, me?.email ?? null));
  }

  const result = await listImportCalendars(user.id, CALENDAR_LIST_SCOPE);
  if (result.ok) return NextResponse.json({ calendars: result.calendars });
  if (result.needsConsent) return NextResponse.json({ needsConsent: true });
  console.error(`[gcal] my-calendars — ${result.error}`);
  return NextResponse.json({ error: "Couldn't read your calendars" }, { status: 502 });
}
