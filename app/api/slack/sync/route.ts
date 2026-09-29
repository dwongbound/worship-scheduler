// POST /api/slack/sync?orgId= — one batch of the "Sync team members" sweep:
// look up this window of the org's people in Slack by email and cache the member
// ids that come back. Admin-only, and re-checked against the db.
//
// The client calls this repeatedly, feeding back the `processed` count as the
// next `offset`, until `done`. That's what keeps each request short enough to
// finish (the lookups are serial and paced) and what gives the modal a real
// progress bar instead of an indefinite spinner.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { syncOrgSlackIds } from "@/lib/slack";

// How many people one request may look up. ~100ms of pacing plus a round trip
// each, so this is a few seconds of work — comfortably inside any function
// timeout, and a fine-grained enough step for the bar to move.
const BATCH_SIZE = 10;

export async function POST(req: NextRequest) {
  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) {
    return NextResponse.json({ error: "orgId required" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(orgId);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  // A negative or non-numeric offset would silently re-scan from the start;
  // clamp it instead so a malformed retry can't loop forever.
  const raw = Number(body?.offset);
  const offset = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;

  const batch = await syncOrgSlackIds(orgId, offset, BATCH_SIZE);
  if (!batch) {
    return NextResponse.json(
      { error: "This org hasn't connected a Slack workspace yet." },
      { status: 409 }
    );
  }
  return NextResponse.json(batch);
}
