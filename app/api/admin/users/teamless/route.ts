// GET /api/admin/users/teamless — the org's members who aren't on any team
// yet. Powers the Team tab's reminder dot + banner in the navbar (admins only).
// Org comes from the x-org-id header; scoped to that org via requireOrgAdmin,
// and "teamless" is judged only by THIS org's team memberships.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Members of this org that hold no team in this org. Team membership is
  // per-org, so `none` is filtered to the caller's org to avoid a user who is
  // teamed elsewhere from being counted as covered here.
  const users = await prisma.user.findMany({
    where: {
      memberships: { some: { orgId: admin.orgId } },
      teams: { none: { orgId: admin.orgId } },
    },
    select: { id: true, name: true, username: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
