// GET /api/admin/users — the org's members: instruments + whether they've
// finished entering availability (the "scheduling completed" log for admins).
// Org comes from the x-org-id header; NOTHING cross-org leaks out of here —
// team chips, responses, and the isAdmin flag are all scoped to that org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    where: { memberships: { some: { orgId: admin.orgId } } },
    select: {
      id: true,
      name: true,
      username: true,
      isMD: true,
      instruments: true,
      // The caller's org's membership row — its isAdmin is what the Team
      // page's checkbox reads/toggles.
      memberships: {
        where: { orgId: admin.orgId },
        select: { isAdmin: true },
      },
      // Team memberships within this org — gate the assignment dropdowns +
      // Team page editing.
      teams: {
        where: { orgId: admin.orgId },
        select: { id: true, name: true },
      },
      // Per-request completion (this org's requests only) — drives the
      // status panel's TimeRange dropdown.
      availabilityResponses: {
        where: { request: { orgId: admin.orgId } },
        select: { requestId: true, completedAt: true, edited: true },
      },
      // The assignment dropdowns (SetDetailModal) use these to flag people who
      // are unavailable at a given set's time. Busy blocks are global to the
      // person by design (they apply to every org).
      unavailability: {
        select: {
          type: true,
          dayOfWeek: true,
          startMinute: true,
          endMinute: true,
          startDate: true,
          endDate: true,
          requestId: true,
          note: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });

  // Flatten the single-org membership row into the isAdmin boolean the
  // client has always consumed.
  return NextResponse.json(
    users.map(({ memberships, ...u }) => ({
      ...u,
      isAdmin: memberships[0]?.isAdmin ?? false,
    }))
  );
}
