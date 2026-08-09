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
    // The targeted teams drive the status panel's "who was asked" list.
    include: { teams: { select: { id: true, name: true } } },
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
  // End date is optional — a single-day request defaults it to the start date.
  const endDate = body.endDate ? parseLocalDate(body.endDate) : startDate;
  if (!startDate || !endDate || startDate > endDate) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Optional custom name; blank/whitespace → null (UI falls back to the range).
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  // Teams to target — only their members are asked (see lib/availabilityTargets).
  // Omitted (older clients / API callers) → every team in the org, which is
  // also what the form defaults to. Ids are re-checked against the org so an
  // admin can't target another org's team.
  const orgTeams = await prisma.team.findMany({
    where: { orgId: admin.orgId },
    select: { id: true },
  });
  const requested: string[] = Array.isArray(body.teamIds)
    ? body.teamIds.filter((id: unknown) => typeof id === "string")
    : orgTeams.map((t) => t.id);
  const teamIds = orgTeams.map((t) => t.id).filter((id) => requested.includes(id));
  // An org with no teams at all still gets a whole-org request; only a caller
  // that named teams and matched none is a mistake worth rejecting.
  if (orgTeams.length > 0 && Array.isArray(body.teamIds) && teamIds.length === 0) {
    return NextResponse.json(
      { error: "Pick at least one team to ask" },
      { status: 400 }
    );
  }

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
    data: {
      name,
      startDate,
      endDate,
      orgId: admin.orgId,
      teams: { connect: teamIds.map((id) => ({ id })) },
    },
    include: { teams: { select: { id: true, name: true } } },
  });

  // DM the targeted teams' members asking them to fill it in. Non-throwing and
  // a no-op when Slack isn't configured.
  await notifyAvailabilityRequest(request);

  return NextResponse.json(request, { status: 201 });
}
