// GET /api/availability-request — each of my orgs' active (most recent)
// availability request, plus whether I still need to respond to it.
// Powers the Availabilities red dot + reminder banner (dot lights if ANY
// org has an unanswered active request). The navbar reads this via the
// aggregated /api/notifications; the shared logic lives in lib/notifications.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { availabilityStatus } from "@/lib/notifications";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await availabilityStatus(user.id));
}
