// GET /api/admin/users/teamless — the org's members who aren't on any team
// yet. Powers the Team tab's reminder dot + banner in the navbar (admins only).
// Org comes from the x-org-id header; scoped to that org via requireOrgAdmin,
// and "teamless" is judged only by THIS org's team memberships. The navbar reads
// this via the aggregated /api/notifications; the query lives in lib/notifications.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { teamlessMembers } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await teamlessMembers(admin.orgId));
}
