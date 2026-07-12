// GET /api/slack/status — whether the Slack bot is configured. Lets the UI
// (e.g. the "Slack Team" button) hide itself when Slack is off.
import { NextResponse } from "next/server";
import { slackEnabled } from "@/lib/slack";

export async function GET() {
  return NextResponse.json({ enabled: slackEnabled() });
}
