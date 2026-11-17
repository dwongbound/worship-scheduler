// POST /api/google-calendar/webhook — Google's push channel for an org's
// calendar. The body is empty; the headers say which channel, its token, and
// what kind of ping it is. We always answer 200 quickly (Google retries
// anything else) and do the read of what changed after responding.
import { after, NextRequest, NextResponse } from "next/server";
import { handleNotification } from "@/lib/googleCalendar";

export async function POST(req: NextRequest) {
  const channelId = req.headers.get("x-goog-channel-id");
  const token = req.headers.get("x-goog-channel-token");
  const state = req.headers.get("x-goog-resource-state");
  after(() => handleNotification(channelId, token, state));
  return new NextResponse(null, { status: 200 });
}
