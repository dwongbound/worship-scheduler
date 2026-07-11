// POST /api/admin/availability-request — an org admin asks their org to
// enter availability over a date range. The newest one per org is that
// org's active request. Org comes from the x-org-id header.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { parseLocalDate } from "@/lib/dates";
import { notifyAvailabilityRequest } from "@/lib/slack";

// GET — the org's requests, newest first (status panel's TimeRange dropdown).
export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const requests = await prisma.availabilityRequest.findMany({
    where: { orgId: admin.orgId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(requests);
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const startDate = parseLocalDate(body.startDate);
  const endDate = parseLocalDate(body.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Optional custom name; blank/whitespace → null (UI falls back to the range).
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  // Storage hygiene: requests are otherwise never deleted, so each new one
  // prunes THIS ORG's requests whose window ended over a year ago. Their
  // SPECIFIC unavailability blocks and responses cascade away with them (the
  // RECURRING blocks users manage themselves are untouched).
  await prisma.availabilityRequest.deleteMany({
    where: {
      orgId: admin.orgId,
      endDate: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    },
  });

  const request = await prisma.availabilityRequest.create({
    data: { name, startDate, endDate, orgId: admin.orgId },
  });

  // DM the org's members asking them to fill it in. Non-throwing and a no-op
  // when Slack isn't configured.
  await notifyAvailabilityRequest(request);

  return NextResponse.json(request, { status: 201 });
}
