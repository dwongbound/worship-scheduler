// GET /api/spotify/callback — Spotify returns here after an admin authorizes the
// shared account. Verify the signed state, re-check admin against the db, then
// exchange the code for a refresh token and store it (encrypted) on the org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { verifyState, connectOrgFromCode } from "@/lib/spotify";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const base = process.env.NEXTAUTH_URL ?? "";
  const back = (status: string) =>
    NextResponse.redirect(`${base}/calendar?spotify=${status}`);

  // Spotify sends `error` (e.g. access_denied) instead of a code on refusal.
  if (params.get("error")) return back("error");

  const state = params.get("state");
  const code = params.get("code");
  if (!state || !code) return back("error");

  const parsed = verifyState(state);
  if (!parsed) return back("error");

  // Re-check admin against the db — never trust the signed state alone.
  const admin = await requireOrgAdminFor(parsed.orgId);
  if (!admin || admin.user.id !== parsed.userId) return back("forbidden");

  const result = await connectOrgFromCode(parsed.orgId, code);
  return back(result.ok ? "connected" : "error");
}
