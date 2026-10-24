// GET /api/google-calendar/callback — Google returns here after an admin
// authorizes the shared account. Verify the signed state, re-check admin
// against the db, then connect (token, calendar, watch channel) and backfill
// every upcoming set as an event once the admin has been sent back.
//
// Every outcome lands on /orgs with ?gcal=<status>, as Spotify's does.
//
// A member's "Import from Google Calendar" comes back here too, told apart by
// its state (lib/googleAvailability.ts); it lands on /schedule instead.
import { after, NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import {
  connectOrgFromCode,
  syncUpcomingSets,
  verifyImportState,
  verifyState,
} from "@/lib/googleCalendar";
import { rememberAccessFromCode } from "@/lib/googleAvailability";

// The member's import comes back here only to have its permission remembered.
// Nothing is imported: they land on /schedule?gcalImport=connected and the
// modal they started in reopens with their calendars now readable.
async function importCallback(
  base: string,
  params: URLSearchParams,
  imported: { userId: string; requestId: string }
): Promise<NextResponse> {
  const back = (status: string, detail?: string) => {
    if (detail) console.error(`[gimport] ${status} — ${detail}`);
    const q = new URLSearchParams({ gcalImport: status, request: imported.requestId });
    return NextResponse.redirect(`${base}/schedule?${q.toString()}`);
  };
  const refused = params.get("error");
  if (refused) return back("denied", refused);
  const code = params.get("code");
  if (!code) return back("error", "no code on the callback");
  // The state names who started it; whoever finishes it must be them.
  const user = await getSessionUser();
  if (!user || user.id !== imported.userId) return back("error", "signed-in user changed mid-import");
  const result = await rememberAccessFromCode(imported.userId, code);
  if (!result.ok) return back("error", result.error);
  return back("connected");
}

// The backfill makes one Google call per upcoming set.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const base = process.env.NEXTAUTH_URL ?? "";
  const back = (status: string, detail?: string) => {
    if (status !== "connected") {
      console.error(`[gcal] connect ${status}${detail ? ` — ${detail}` : ""}`);
    }
    return NextResponse.redirect(`${base}/orgs?gcal=${status}`);
  };

  const state = params.get("state");
  const imported = state ? verifyImportState(state) : null;
  if (imported) return importCallback(base, params, imported);

  const refused = params.get("error");
  if (refused) return back("denied", refused);

  const code = params.get("code");
  if (!state || !code) return back("expired", "no state/code on the callback");

  const parsed = verifyState(state);
  if (!parsed) return back("expired", "state failed its signature check or is over 10 min old");

  const admin = await requireOrgAdminFor(parsed.orgId);
  if (!admin || admin.user.id !== parsed.userId) {
    return back("forbidden", `user ${parsed.userId} is not an admin of org ${parsed.orgId}`);
  }

  const result = await connectOrgFromCode(parsed.orgId, code, parsed.userId);
  if (!result.ok) return back("error", result.error);
  after(() => syncUpcomingSets(parsed.orgId));
  return back("connected");
}
