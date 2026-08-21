// GET /api/spotify/callback — Spotify returns here after an admin authorizes the
// shared account. Verify the signed state, re-check admin against the db, then
// exchange the code for a refresh token and store it (encrypted) on the org.
//
// Every outcome lands the admin back on /orgs (where the Connect button lives)
// with ?spotify=<status>. The statuses are deliberately specific: a single
// opaque "error" made a prod failure impossible to tell apart from a cancelled
// consent screen or a refreshed callback URL. The gory detail goes to the
// server log — the page only ever shows its own copy for the status.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { verifyState, connectOrgFromCode } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const base = process.env.NEXTAUTH_URL ?? "";
  const back = (status: string, detail?: string) => {
    if (status !== "connected") {
      console.error(`[spotify] connect ${status}${detail ? ` — ${detail}` : ""}`);
    }
    return NextResponse.redirect(`${base}/orgs?spotify=${status}`);
  };

  // Spotify sends `error` (e.g. access_denied) instead of a code on refusal.
  const refused = params.get("error");
  if (refused) return back("denied", refused);

  const state = params.get("state");
  const code = params.get("code");
  // No params at all = someone opened/refreshed this URL directly; the code is
  // single-use, so a refresh after a successful connect looks the same.
  if (!state || !code) return back("expired", "no state/code on the callback");

  const parsed = verifyState(state);
  if (!parsed) return back("expired", "state failed its signature check or is over 10 min old");

  // Re-check admin against the db — never trust the signed state alone.
  const admin = await requireOrgAdminFor(parsed.orgId);
  if (!admin || admin.user.id !== parsed.userId) {
    return back("forbidden", `user ${parsed.userId} is not an admin of org ${parsed.orgId}`);
  }

  const result = await connectOrgFromCode(parsed.orgId, code);
  return result.ok ? back("connected") : back("error", result.error);
}
