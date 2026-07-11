// GET  /api/availability — my unavailability entries + completion status.
// POST /api/availability — add an entry (RECURRING or SPECIFIC).
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getMyOrgIds } from "@/lib/org";
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

  // All my blocks + my orgs' requests (for the TimeRange dropdown, labeled
  // with the org they came from) + which requests I've marked complete.
  // Busy blocks themselves are global to the person — they apply everywhere.
  const [entries, requests, responses] = await Promise.all([
    prisma.unavailability.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    }),
    prisma.availabilityRequest.findMany({
      where: { orgId: { in: await getMyOrgIds(user.id) } },
      include: { org: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.availabilityResponse.findMany({
      where: { userId: user.id },
      select: { requestId: true, completedAt: true, edited: true },
    }),
  ]);

  return NextResponse.json({ entries, requests, responses });
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
    // Reject an exact duplicate (same day + time window) so the list can't
    // accumulate identical rows.
    const dupe = await prisma.unavailability.findFirst({
      where: { userId: user.id, type: "RECURRING", dayOfWeek, startMinute, endMinute },
    });
    if (dupe) {
      return NextResponse.json(
        { error: "That block already exists" },
        { status: 409 }
      );
    }
    const entry = await prisma.unavailability.create({
      data: { userId: user.id, type: "RECURRING", dayOfWeek, startMinute, endMinute },
    });
    return NextResponse.json(entry, { status: 201 });
  }

  if (body.type === "SPECIFIC") {
    // A specific block: a date (or date range via optional `endDate`) plus a
    // time window. It MAY be tied to a request (requestId) — a standalone block
    // (e.g. drag-to-block on the calendar) has no requestId, in which case we
    // skip the request-window check.
    const { requestId, startMinute, endMinute } = body;
    const date = parseLocalDate(body.date);
    // endDate is optional — omit it for a single-day block.
    const endDate = body.endDate ? parseLocalDate(body.endDate) : null;
    if (
      isNaN(date.getTime()) ||
      (endDate && (isNaN(endDate.getTime()) || endDate < date)) ||
      typeof startMinute !== "number" ||
      typeof endMinute !== "number" ||
      startMinute >= endMinute
    ) {
      return NextResponse.json(
        { error: "Invalid specific block" },
        { status: 400 }
      );
    }
    // When tied to a request, the whole range must fall inside its window.
    if (requestId != null) {
      if (typeof requestId !== "string") {
        return NextResponse.json(
          { error: "Invalid specific block" },
          { status: 400 }
        );
      }
      const request = await prisma.availabilityRequest.findUnique({
        where: { id: requestId },
        select: { startDate: true, endDate: true },
      });
      if (
        !request ||
        date < request.startDate ||
        date > request.endDate ||
        (endDate && endDate > request.endDate)
      ) {
        return NextResponse.json(
          { error: "Date is outside the requested range" },
          { status: 400 }
        );
      }
    }
    const entry = await prisma.unavailability.create({
      data: {
        userId: user.id,
        type: "SPECIFIC",
        startDate: date,
        endDate,
        startMinute,
        endMinute,
        requestId: typeof requestId === "string" ? requestId : null,
      },
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
