// GET  /api/availability — my unavailability entries + completion status.
// POST /api/availability — add an entry (RECURRING or SPECIFIC); RECURRING
//      also takes a `blocks` array to add several weekday/window blocks at once.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { targetsUser } from "@/lib/availabilityTargets";
import { getMyOrgIds } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { toYmd } from "@/lib/dates";

// Parse "YYYY-MM-DD" (from <input type=date>) as LOCAL midnight.
// `new Date("2026-08-05")` would be UTC midnight, which displays as the
// previous day in timezones west of UTC.
function parseLocalDate(value: string): Date {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// One weekly recurring block as it arrives from the client. `endDate` is the
// last day it applies ("YYYY-MM-DD"); absent/null = repeats forever.
interface RecurringInput {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  endDate?: string | null;
}

function isValidRecurring(block: RecurringInput): boolean {
  return (
    !!block &&
    typeof block.dayOfWeek === "number" &&
    block.dayOfWeek >= 0 &&
    block.dayOfWeek <= 6 &&
    typeof block.startMinute === "number" &&
    typeof block.endMinute === "number" &&
    block.startMinute < block.endMinute &&
    (block.endDate == null ||
      (typeof block.endDate === "string" &&
        !isNaN(parseLocalDate(block.endDate).getTime())))
  );
}

// Identity of a recurring block, for duplicate detection.
function recurringKey(block: {
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  endDate?: Date | string | null;
}): string {
  // A block that stops on a different date is a different block.
  const end = block.endDate
    ? toYmd(
        block.endDate instanceof Date
          ? block.endDate
          : parseLocalDate(block.endDate)
      )
    : "forever";
  return `${block.dayOfWeek}-${block.startMinute}-${block.endMinute}-${end}`;
}

// The db row for one recurring block (its stop date as a local-midnight Date).
function toRecurringRow(block: RecurringInput) {
  return {
    dayOfWeek: block.dayOfWeek,
    startMinute: block.startMinute,
    endMinute: block.endMinute,
    endDate: block.endDate ? parseLocalDate(block.endDate) : null,
  };
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
      where: {
        orgId: { in: await getMyOrgIds(user.id) },
        // Only requests aimed at a team I'm on (lib/availabilityTargets).
        ...targetsUser(user.id),
      },
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
    // Two shapes: one block ({dayOfWeek, startMinute, endMinute}), or a batch
    // ({ blocks: [...] }) from the multi-select form — "Mon–Fri mornings" is
    // one gesture that lands as several rows.
    const isBatch = Array.isArray(body.blocks);
    const raw = (isBatch ? body.blocks : [body]) as RecurringInput[];
    if (raw.length === 0 || !raw.every(isValidRecurring)) {
      return NextResponse.json(
        { error: "Invalid recurring entry" },
        { status: 400 }
      );
    }
    // Keep only the fields we store — the single-block shape arrives as the
    // whole request body.
    const incoming: RecurringInput[] = raw.map(
      ({ dayOfWeek, startMinute, endMinute, endDate }) => ({
        dayOfWeek,
        startMinute,
        endMinute,
        endDate: endDate ?? null,
      })
    );

    // Drop anything that already exists (same day + time window), and any
    // repeat inside the batch itself, so the list can't accumulate identical
    // rows.
    const existing = await prisma.unavailability.findMany({
      where: { userId: user.id, type: "RECURRING" },
      select: {
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        endDate: true,
      },
    });
    const seen = new Set(existing.map(recurringKey));
    const fresh: RecurringInput[] = [];
    for (const block of incoming) {
      const key = recurringKey(block);
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(block);
    }

    if (!isBatch) {
      if (fresh.length === 0) {
        return NextResponse.json(
          { error: "That block already exists" },
          { status: 409 }
        );
      }
      const entry = await prisma.unavailability.create({
        data: { userId: user.id, type: "RECURRING", ...toRecurringRow(fresh[0]) },
      });
      return NextResponse.json(entry, { status: 201 });
    }

    await prisma.unavailability.createMany({
      data: fresh.map((block) => ({
        userId: user.id,
        type: "RECURRING" as const,
        ...toRecurringRow(block),
      })),
    });
    return NextResponse.json(
      { created: fresh.length, skipped: incoming.length - fresh.length },
      { status: 201 }
    );
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
