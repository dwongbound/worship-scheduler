// "Import from Google Calendar" on /schedule, the two halves that aren't JSON
// reads:
//
//   GET  — the consent trip. A full navigation to Google, because a consent
//          screen can't live in a fetch. It lands back on
//          /schedule?gcalImport=connected, which REOPENS the modal rather than
//          importing anything: coming back from Google now looks like arriving
//          at the picker, not like the app restarting.
//   POST — the import itself, for the calendars the person ticked.
//
// The picker's list and the preview are the two routes beside this one.
// See lib/googleAvailability.ts.
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importAuthorizeUrl, runImportFor } from "@/lib/googleAvailability";
import { guardImport } from "./guard";

export async function GET(req: NextRequest) {
  const requestId = req.nextUrl.searchParams.get("requestId");
  const guard = await guardImport(requestId);
  if (!guard.ok) return guard.response;

  const { email } = (await prisma.user.findUnique({
    where: { id: guard.userId },
    select: { email: true },
  })) ?? { email: null };
  return NextResponse.redirect(importAuthorizeUrl(guard.userId, guard.requestId, email));
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    requestId?: string;
    calendarIds?: unknown;
  };
  const guard = await guardImport(body.requestId ?? null);
  if (!guard.ok) return guard.response;

  const calendarIds = Array.isArray(body.calendarIds)
    ? body.calendarIds.filter((id): id is string => typeof id === "string" && !!id)
    : [];
  const result = await runImportFor(guard.userId, guard.requestId, calendarIds);
  if (result.ok) return NextResponse.json({ blocks: result.blocks });
  if (result.needsConsent) return NextResponse.json({ needsConsent: true });
  console.error(`[gimport] import — ${result.error}`);
  return NextResponse.json({ error: "Couldn't import from Google Calendar" }, { status: 502 });
}
