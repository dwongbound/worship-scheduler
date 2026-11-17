// GET /api/swaps — open swap requests the current user could take:
// upcoming, someone else's, for an instrument the user plays, within the
// user's orgs (?orgId= narrows to one — the My Sets org filter), on
// the set's own team (a team-less set is open to the whole org), and not
// already declined by this user (POST /api/swaps/:id/decline).
// Also powers the navbar red dot (it just checks the count, all orgs).
// The rule itself is lib/openCovers.ts, shared with the access key's MCP tool.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { openCoversFor } from "@/lib/openCovers";
import { resolveOrgScope } from "@/lib/org";

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  return NextResponse.json(await openCoversFor(user.id, scope));
}
