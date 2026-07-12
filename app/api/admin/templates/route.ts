// GET/POST /api/admin/templates — the org's weekly set-time templates.
// Org admin only; org comes from the x-org-id header.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { validateSlotCapacities } from "@/lib/constants";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const templates = await prisma.setTemplate.findMany({
    where: { orgId: admin.orgId },
    include: { team: { select: { id: true, name: true } } },
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    label,
    dayOfWeek,
    startMinute,
    durationMinutes,
    slotCapacities,
    requiresMD,
    teamId,
  } = await req.json();
  if (
    typeof label !== "string" || label.trim().length === 0 ||
    typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6 ||
    typeof startMinute !== "number" || startMinute < 0 || startMinute >= 1440 ||
    typeof durationMinutes !== "number" || durationMinutes <= 0
  ) {
    return NextResponse.json({ error: "Invalid template" }, { status: 400 });
  }

  // slotCapacities is optional; when present it must be a valid role→count map.
  let capacities = null;
  if (slotCapacities !== undefined) {
    capacities = validateSlotCapacities(slotCapacities);
    if (!capacities) {
      return NextResponse.json(
        { error: "Invalid slot capacities" },
        { status: 400 }
      );
    }
  }

  // Every template targets a team in THIS org; its generated sets inherit it.
  if (typeof teamId !== "string" || teamId.length === 0) {
    return NextResponse.json({ error: "Team is required" }, { status: 400 });
  }
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team || team.orgId !== admin.orgId) {
    return NextResponse.json({ error: "Team not found" }, { status: 400 });
  }

  const template = await prisma.setTemplate.create({
    data: {
      label: label.trim(),
      dayOfWeek,
      startMinute,
      durationMinutes,
      requiresMD: Boolean(requiresMD),
      slotCapacities: capacities ?? undefined,
      teamId,
      orgId: admin.orgId,
    },
  });
  return NextResponse.json(template, { status: 201 });
}
