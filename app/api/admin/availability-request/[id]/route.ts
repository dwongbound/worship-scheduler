// DELETE /api/admin/availability-request/[id] — an org admin removes an
// availability request from the status card. Org admin only, and the request
// must belong to the caller's org (same scoping as the sibling remind route).
//
// The delete cascades: both AvailabilityResponse (who marked it complete) and
// the SPECIFIC Unavailability blocks entered against it point at the request
// with `onDelete: Cascade`, so everyone's answers go with it. That's why the
// UI puts this behind a confirm modal that spells the loss out.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const request = await prisma.availabilityRequest.findUnique({
    where: { id },
    select: { orgId: true },
  });
  // Scope to the caller's org so an admin can't delete another org's request.
  if (!request || request.orgId !== admin.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.availabilityRequest.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
