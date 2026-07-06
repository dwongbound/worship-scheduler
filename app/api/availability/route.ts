// GET  /api/availability — my unavailability entries + completion status.
// POST /api/availability — add an entry (RECURRING or DATE_RANGE).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// Parse "YYYY-MM-DD" (from <input type=date>) as LOCAL midnight.
// `new Date("2026-08-05")` would be UTC midnight, which displays as the
// previous day in timezones west of UTC.
function parseLocalDate(value: string): Date {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [entries, me] = await Promise.all([
    prisma.unavailability.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: { scheduleCompletedAt: true },
    }),
  ]);

  return NextResponse.json({
    entries,
    scheduleCompletedAt: me?.scheduleCompletedAt ?? null,
  });
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (body.type === "RECURRING") {
    const { dayOfWeek, startMinute, endMinute } = body;
    if (
      typeof dayOfWeek !== "number" || dayOfWeek < 0 || dayOfWeek > 6 ||
      typeof startMinute !== "number" || typeof endMinute !== "number" ||
      startMinute >= endMinute
    ) {
      return NextResponse.json(
        { error: "Invalid recurring entry" },
        { status: 400 }
      );
    }
    const entry = await prisma.unavailability.create({
      data: { userId: user.id, type: "RECURRING", dayOfWeek, startMinute, endMinute },
    });
    return NextResponse.json(entry, { status: 201 });
  }

  if (body.type === "DATE_RANGE") {
    const startDate = parseLocalDate(body.startDate);
    const endDate = parseLocalDate(body.endDate);
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || startDate > endDate) {
      return NextResponse.json(
        { error: "Invalid date range" },
        { status: 400 }
      );
    }
    const entry = await prisma.unavailability.create({
      data: {
        userId: user.id,
        type: "DATE_RANGE",
        startDate,
        endDate,
        note: body.note ?? null,
      },
    });
    return NextResponse.json(entry, { status: 201 });
  }

  return NextResponse.json({ error: "Unknown type" }, { status: 400 });
}
