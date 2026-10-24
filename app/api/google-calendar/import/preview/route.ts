// GET /api/google-calendar/import/preview?requestId=&calendarIds=a,b — what
// importing those calendars WOULD block: the merged busy windows, written
// nowhere. The modal draws them in its week preview.
//
// It runs the import's own code (lib/googleAvailability previewImport), so
// what the preview shows is what the import writes, not an estimate of it.
import { NextRequest, NextResponse } from "next/server";
import { previewImport } from "@/lib/googleAvailability";
import { guardImport, parseCalendarIds } from "../guard";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const guard = await guardImport(params.get("requestId"));
  if (!guard.ok) return guard.response;

  const result = await previewImport(
    guard.userId,
    guard.requestId,
    parseCalendarIds(params.get("calendarIds"))
  );
  if (result.ok) return NextResponse.json({ windows: result.windows });
  if (result.needsConsent) return NextResponse.json({ needsConsent: true });
  console.error(`[gimport] preview — ${result.error}`);
  return NextResponse.json({ error: "Couldn't read your calendars" }, { status: 502 });
}
