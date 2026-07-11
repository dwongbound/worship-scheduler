// GET /api/orgs — the current user's org memberships (id, name, isAdmin),
// oldest org first. Also the app's regular touchpoint for syncing env-declared
// orgs into the db (OrgProvider hits this on every page load).
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureOrgsSynced, getMyMemberships } from "@/lib/org";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureOrgsSynced();
  const memberships = await getMyMemberships(user.id);
  return NextResponse.json(
    memberships.map((m) => ({ id: m.orgId, name: m.orgName, isAdmin: m.isAdmin }))
  );
}
