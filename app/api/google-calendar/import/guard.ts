// What every "Import from Google Calendar" endpoint checks first: a signed-in
// person, a deployment with the Google app configured, and a request this
// person is actually asked about. Shared by the three routes beside it so the
// checks can't drift apart.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { isGoogleCalendarAppConfigured } from "@/lib/googleCalendar";
import { importableRequest } from "@/lib/googleAvailability";

export type Guarded =
  | { ok: true; userId: string; requestId: string }
  | { ok: false; response: NextResponse };

export async function guardImport(requestId: string | null): Promise<Guarded> {
  const fail = (error: string, status: number): Guarded => ({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });
  const user = await getSessionUser();
  if (!user) return fail("Unauthorized", 401);
  if (!requestId) return fail("requestId required", 400);
  if (!isGoogleCalendarAppConfigured()) return fail("Google Calendar not configured", 500);
  if (!(await importableRequest(user.id, requestId))) return fail("Not found", 404);
  return { ok: true, userId: user.id, requestId };
}

/** `?calendarIds=a,b` → ["a", "b"]. */
export function parseCalendarIds(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
