// GET /api/google-calendar/import/calendars?requestId= — the calendars the
// import modal's picker lists: this person's OWN Google calendars, by name.
// Calendars they merely subscribe to (holidays, a fixture feed) are left out
// upstream, in lib/googleAvailability.
//
// `{ needsConsent: true }` means there's no usable remembered permission, so
// the modal sends them through Google's consent screen and comes back here.
import { NextRequest, NextResponse } from "next/server";
import { listImportCalendars } from "@/lib/googleAvailability";
import { guardImport } from "../guard";

export async function GET(req: NextRequest) {
  const guard = await guardImport(req.nextUrl.searchParams.get("requestId"));
  if (!guard.ok) return guard.response;

  const result = await listImportCalendars(guard.userId);
  if (result.ok) return NextResponse.json({ calendars: result.calendars });
  if (result.needsConsent) return NextResponse.json({ needsConsent: true });
  console.error(`[gimport] calendars — ${result.error}`);
  return NextResponse.json({ error: "Couldn't read your calendars" }, { status: 502 });
}
