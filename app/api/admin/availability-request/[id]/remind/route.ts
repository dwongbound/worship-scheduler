// POST /api/admin/availability-request/[id]/remind — re-send the "please enter
// your availability" Slack DM to everyone in the request's org who has Slack
// linked. Same message the request originally sent; used as a nudge from the
// Availability status card. Org admin only; the request must belong to the org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { notifyAvailabilityRequest } from "@/lib/slack";

export async function POST(
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
  });
  // Scope to the caller's org so an admin can't nudge another org's members.
  if (!request || request.orgId !== admin.orgId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await notifyAvailabilityRequest(request);

  return NextResponse.json({ ok: true });
}
