// GET /api/google-calendar/import?requestId= — a member starts "Import from
// Google Calendar" for one availability request. Redirects to Google's consent
// screen (or straight through, once granted); the shared callback reads their
// calendar and writes the blocks. See lib/googleAvailability.ts.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isGoogleCalendarAppConfigured } from "@/lib/googleCalendar";
import { importAuthorizeUrl, importableRequest } from "@/lib/googleAvailability";

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

  const { email } = (await prisma.user.findUnique({
    where: { id: user.id },
    select: { email: true },
  })) ?? { email: null };
  return NextResponse.redirect(importAuthorizeUrl(user.id, requestId, email));
}
