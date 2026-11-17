// GET /api/agent — everything a person's access key can read, in one answer
// (lib/agentSnapshot.ts). For an assistant that would rather make one HTTP
// call than speak MCP; /api/mcp serves the same data as tools.
//
// Authenticated by `Authorization: Bearer tw_…` ONLY. A browser session is
// not accepted, so this route can't become a second way for a page to read
// data it should get from the ordinary routes.
import { NextResponse } from "next/server";
import { getKeyUser } from "@/lib/accessKeyAuth";
import { agentSnapshot } from "@/lib/agentSnapshot";

export async function GET(req: Request) {
  const user = await getKeyUser(req);
  if (!user) return unauthorized();
  return NextResponse.json(await agentSnapshot(user, new URL(req.url).origin), {
    // One person's schedule: never cached by anything in between.
    headers: { "Cache-Control": "no-store" },
  });
}

/** 401 with the header that tells a client a bearer key is what's wanted. */
function unauthorized() {
  return NextResponse.json(
    { error: "Send a personal access key: Authorization: Bearer tw_… (make one on your profile)." },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="tapworship"' } }
  );
}
