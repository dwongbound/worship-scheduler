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
import { validateTemplatePractices } from "@/lib/practices";

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const templates = await prisma.setTemplate.findMany({
    where: { orgId: admin.orgId },
    include: {
      team: { select: { id: true, name: true } },
      // The practices this time hands down. The Create tab's list reads the
      // COUNT off these (the "+2" after the time), and the editor reads the
      // rows themselves, so one request serves both.
      practices: {
        select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      },
    },
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
    practices,
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

  // Practices are optional; when present they're an offset from the set each
  // generated occurrence becomes (lib/practices.ts). Validated before the
  // write, so a bad one can't create the template and lose its practices.
  const practiceCheck = validateTemplatePractices(practices);
  if ("error" in practiceCheck) {
    return NextResponse.json({ error: practiceCheck.error }, { status: 400 });
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

  // Nested creates rather than a createMany + a second write: a template and
  // its practices arrive as one gesture, so they commit as one.
  const withPractices =
    practiceCheck.practices.length > 0
      ? { practices: { create: practiceCheck.practices } }
      : {};
  const include = {
    practices: {
      select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true },
      orderBy: [{ dayOfWeek: "asc" as const }, { startMinute: "asc" as const }],
    },
  };

  // The single-day form answers with the row it created, as it always has.
  if (!isBatch) {
    const template = await prisma.setTemplate.create({
      data: { ...shared, ...withPractices, dayOfWeek: days[0] as number },
      include,
    });
    return NextResponse.json(template, { status: 201 });
  }
  // One row per checked day, each with its own copy of the practices, in one
  // transaction — the same all-or-nothing the multi-day form already had.
  const templates = await prisma.$transaction(
    (days as number[]).map((day) =>
      prisma.setTemplate.create({
        data: { ...shared, ...withPractices, dayOfWeek: day },
        include,
      })
    )
  );
  return NextResponse.json(templates, { status: 201 });
}
