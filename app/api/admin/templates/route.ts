// GET/POST /api/admin/templates — weekly set-time templates (admin only).
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateSlotCapacities } from "@/lib/constants";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const templates = await prisma.setTemplate.findMany({
    orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
  });
  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { label, dayOfWeek, startMinute, durationMinutes, slotCapacities } =
    await req.json();
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

  const template = await prisma.setTemplate.create({
    data: {
      label: label.trim(),
      dayOfWeek,
      startMinute,
      durationMinutes,
      slotCapacities: capacities ?? undefined,
    },
  });
  return NextResponse.json(template, { status: 201 });
}
