// GET /api/google-calendar/import?requestId= — a member runs "Import from
// Google Calendar" for one availability request. Once they've granted access
// it imports right here and lands back on /schedule; the first time (or after
// they revoke it) it redirects to Google's consent screen, and the shared
// callback finishes the import. See lib/googleAvailability.ts.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isGoogleCalendarAppConfigured } from "@/lib/googleCalendar";
import {
  hasRememberedAccess,
  importAuthorizeUrl,
  importWithRememberedAccess,
  importableRequest,
} from "@/lib/googleAvailability";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const requestId = req.nextUrl.searchParams.get("requestId");
  if (!requestId) {
    return NextResponse.json({ error: "requestId required" }, { status: 400 });
  }
  if (!isGoogleCalendarAppConfigured()) {
    return NextResponse.json({ error: "Google Calendar not configured" }, { status: 500 });
  }
  if (!(await importableRequest(user.id, requestId))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (await hasRememberedAccess(user.id)) {
    const result = await importWithRememberedAccess(user.id, requestId);
    if (result.ok || !result.needsConsent) {
      const q = new URLSearchParams({
        gcalImport: result.ok ? String(result.blocks) : "error",
        request: requestId,
      });
      if (!result.ok) console.error(`[gimport] error — ${result.error}`);
      return NextResponse.redirect(new URL(`/schedule?${q.toString()}`, req.url));
    }
    // Revoked since, or remembered from before the app read the calendar LIST:
    // fall through and ask again, which is also how an old token gains the
    // scope that lets the import see every calendar rather than just primary.
  }

  const { email } = (await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true },
  })) ?? { email: null };
  return NextResponse.redirect(importAuthorizeUrl(user.id, requestId, email));
}
