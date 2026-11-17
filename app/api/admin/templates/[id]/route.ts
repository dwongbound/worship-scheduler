// PATCH/DELETE /api/admin/templates/:id — org admin only (org derived from the
// template itself).
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
// Value import (not `import type`) — Prisma.DbNull is a runtime sentinel.
import { Prisma } from "@/lib/generated/prisma/client";
import { validateSlotCapacities, parseGroupChatLeadDays } from "@/lib/constants";
import { validateTemplatePractices } from "@/lib/practices";

// Edit one weekly time in place — the same fields POST takes, minus the
// multi-day batch (a row IS one day, so editing swaps which day it recurs on).
// Existing sets already expanded from it aren't touched; the change only
// affects the next generate run.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await prisma.setTemplate.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(existing.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const {
    label,
    dayOfWeek,
    startMinute,
    durationMinutes,
    slotCapacities,
    requiresMD,
    groupChatLeadDays,
    teamId,
    practices,
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
  // Sending null (rather than omitting it) clears back to the default shape.
  let capacities = null;
  if (slotCapacities !== undefined && slotCapacities !== null) {
    capacities = validateSlotCapacities(slotCapacities);
    if (!capacities) {
      return NextResponse.json(
        { error: "Invalid slot capacities" },
        { status: 400 }
      );
    }
  }

  // Practices replace the whole list, like the scheduling rules PUT: the
  // editor shows them all at once, so a save IS the new list. Omitting the
  // field leaves the existing practices alone, so a caller that predates this
  // (or only means to rename the time) can't wipe them.
  const practiceCheck =
    practices === undefined ? null : validateTemplatePractices(practices);
  if (practiceCheck && "error" in practiceCheck) {
    return NextResponse.json({ error: practiceCheck.error }, { status: 400 });
  }

  // The template can be moved between teams, but only within its own org.
  if (typeof teamId !== "string" || teamId.length === 0) {
    return NextResponse.json({ error: "Team is required" }, { status: 400 });
  }
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team || team.orgId !== existing.orgId) {
    return NextResponse.json({ error: "Team not found" }, { status: 400 });
  }

  const template = await prisma.setTemplate.update({
    where: { id },
    data: {
      label: label.trim(),
      dayOfWeek,
      startMinute,
      durationMinutes,
      requiresMD: Boolean(requiresMD),
      groupChatLeadDays: parseGroupChatLeadDays(groupChatLeadDays),
      // DbNull writes a real SQL NULL, i.e. "back to the default team shape".
      slotCapacities: capacities ?? Prisma.DbNull,
      teamId,
      // Delete-then-create inside the one update, so a save can never leave
      // the old practices beside the new ones. Sets already generated from
      // this template keep the practices they were given — the same bargain
      // slotCapacities makes, and the form says so.
      ...(practiceCheck
        ? {
            practices: {
              deleteMany: {},
              create: practiceCheck.practices,
            },
          }
        : {}),
    },
    include: {
      practices: {
        select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true },
        orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
      },
    },
  });
  return NextResponse.json(template);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.setTemplate.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(template.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.setTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
