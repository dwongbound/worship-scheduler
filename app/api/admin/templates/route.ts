// GET/POST /api/admin/templates — the org's weekly set-time templates.
//
// POST takes one `dayOfWeek`, or a `daysOfWeek` array for the form's
// multi-day picker: "Tuesday and Thursday, 7pm" is one gesture, so it's one
// request creating both — and one all-or-nothing write, rather than a POST
// per day that could leave half the days created when one of them fails.
// Org admin only; org comes from the x-org-id header.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { validateSlotCapacities, parseGroupChatLeadDays } from "@/lib/constants";

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
    daysOfWeek,
    startMinute,
    durationMinutes,
    slotCapacities,
    requiresMD,
    groupChatLeadDays,
    teamId,
  } = await req.json();
  // One day or several — the batch form is the only difference between them.
  const isBatch = Array.isArray(daysOfWeek);
  const days: unknown[] = isBatch ? daysOfWeek : [dayOfWeek];
  const validDay = (d: unknown) =>
    typeof d === "number" && d >= 0 && d <= 6;
  if (
    typeof label !== "string" || label.trim().length === 0 ||
    days.length === 0 || !days.every(validDay) ||
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

  const shared = {
    label: label.trim(),
    startMinute,
    durationMinutes,
    requiresMD: Boolean(requiresMD),
    groupChatLeadDays: parseGroupChatLeadDays(groupChatLeadDays),
    slotCapacities: capacities ?? undefined,
    teamId,
    orgId: admin.orgId,
  };

  // The single-day form answers with the row it created, as it always has.
  if (!isBatch) {
    const template = await prisma.setTemplate.create({
      data: { ...shared, dayOfWeek: days[0] as number },
    });
    return NextResponse.json(template, { status: 201 });
  }
  const templates = await prisma.setTemplate.createManyAndReturn({
    data: (days as number[]).map((day) => ({ ...shared, dayOfWeek: day })),
  });
  return NextResponse.json(templates, { status: 201 });
}
