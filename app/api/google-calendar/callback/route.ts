// GET /api/google-calendar/callback — Google returns here after an admin
// authorizes the shared account. Verify the signed state, re-check admin
// against the db, then connect (token, calendar, watch channel) and backfill
// every upcoming set as an event once the admin has been sent back.
//
// Every outcome lands on /orgs with ?gcal=<status>, as Spotify's does.
import { after, NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { connectOrgFromCode, syncUpcomingSets, verifyState } from "@/lib/googleCalendar";

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

  const refused = params.get("error");
  if (refused) return back("denied", refused);

  const state = params.get("state");
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
