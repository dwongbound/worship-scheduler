// POST /api/availability/block-days — paint or erase a run of whole days on
// the availability calendar, keeping stored blocks clean.
//   { start, end, blocked: true }  → block every day in [start, end]
//   { start, end, blocked: false } → mark every day in [start, end] fully free
//
// PAINTING only ever creates all-day blocks, merges them into the fewest
// ranges, and never double-blocks a day (so clicking the same date twice can't
// pile up duplicates).
//
// ERASING is "I'm free all of these days" — a right-click, or a long press on
// touch — so it removes EVERY dated block touching them, partial-day ones
// included, not just the all-day ones. A block that only partly overlaps is
// split into the pieces that survive, keeping its own time window, requestId
// and note, so a request-tied morning block stays a request-tied morning block
// on the days it still covers.
//
// Weekly RECURRING rules are CLIPPED rather than left standing — a day isn't
// free while a repeat still covers it. There's no per-date exception in the
// schema, so the rule is cut into the piece before the erased run and the piece
// after it (`lib/availability.ts clipRecurringAroundDays`), and a piece with no
// occurrence left to come is dropped. The response says how many rules were
// clipped (`recurringClipped`) so the caller can mention that the repeat
// changed shape.
import { NextRequest, NextResponse } from "next/server";
import { clipRecurringAroundDays } from "@/lib/availability";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const FULL_DAY_END = 24 * 60; // minutes — an all-day block spans 0 → this

// Parse "YYYY-MM-DD" as LOCAL midnight (UTC parsing would shift a day west).
function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// A block covers whole days when its window runs 0 → end-of-day.
function isAllDay(b: { startMinute: number | null; endMinute: number | null }) {
  return (b.startMinute ?? 0) <= 0 && (b.endMinute ?? FULL_DAY_END) >= FULL_DAY_END;
}

// Every YYYY-MM-DD a block touches (endDate defaults to startDate). SPECIFIC
// rows carry a nullable startDate in the schema; a dateless one touches nothing.
function daysOf(b: { startDate: Date | null; endDate: Date | null }): string[] {
  if (!b.startDate) return [];
  const end = startOfDay(b.endDate ?? b.startDate);
  const out: string[] = [];
  for (let d = startOfDay(b.startDate); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

// Collapse a set of days into the fewest consecutive [start, end] runs.
function rangesFromDays(days: Set<string>): [Date, Date][] {
  const ranges: [Date, Date][] = [];
  for (const key of [...days].sort()) {
    const d = parseLocalDate(key)!;
    const last = ranges[ranges.length - 1];
    const nextAfterLast = last && startOfDay(last[1]);
    if (nextAfterLast) nextAfterLast.setDate(nextAfterLast.getDate() + 1);
    if (last && nextAfterLast && ymd(nextAfterLast) === key) {
      last[1] = d; // extends the current run
    } else {
      ranges.push([d, d]);
    }
  }
  return ranges;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const start = parseLocalDate(body.start);
  const end = parseLocalDate(body.end);
  const blocked = body.blocked === true;
  if (!start || !end || start > end) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  // Days the request targets, and all of my all-day specific blocks.
  const targetDays = new Set<string>();
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    targetDays.add(ymd(d));
  }
  // Every DATED block (all-day or timed). Painting only cares about the all-day
  // ones; erasing sweeps the lot.
  const specific = await prisma.unavailability.findMany({
    where: { userId: user.id, type: { in: ["SPECIFIC", "DATE_RANGE"] } },
  });
  const allDay = specific.filter(isAllDay);

  if (blocked) {
    // Paint. Merge the target days into my STANDALONE (requestId-null) blocks,
    // but skip days already covered by any all-day block — no double-blocking.
    const covered = new Set<string>();
    for (const b of allDay) for (const day of daysOf(b)) covered.add(day);
    const newDays = [...targetDays].filter((d) => !covered.has(d));
    if (newDays.length === 0) {
      return NextResponse.json({ ok: true }); // nothing to add
    }
    const standalone = allDay.filter((b) => b.requestId == null);
    const finalDays = new Set<string>(newDays);
    for (const b of standalone) for (const day of daysOf(b)) finalDays.add(day);

    await prisma.$transaction([
      prisma.unavailability.deleteMany({
        where: { id: { in: standalone.map((b) => b.id) } },
      }),
      ...rangesFromDays(finalDays).map(([s, e]) =>
        prisma.unavailability.create({
          data: {
            userId: user.id,
            type: "SPECIFIC",
            startDate: s,
            endDate: ymd(s) === ymd(e) ? null : e,
            startMinute: 0,
            endMinute: FULL_DAY_END,
          },
        })
      ),
    ]);
    return NextResponse.json({ ok: true });
  }

  // Erase — "these days are fully free". Every dated block touching them goes,
  // whatever its time window; a block that only partly overlaps is rebuilt from
  // the days it still covers, keeping its own window, requestId and note.
  const ops = [];
  for (const b of specific) {
    const days = daysOf(b);
    const survivors = new Set(days.filter((d) => !targetDays.has(d)));
    if (survivors.size === days.length) continue; // untouched
    ops.push(
      prisma.unavailability.delete({ where: { id: b.id } }),
      ...rangesFromDays(survivors).map(([s, e]) =>
        prisma.unavailability.create({
          data: {
            userId: user.id,
            type: b.type,
            startDate: s,
            endDate: ymd(s) === ymd(e) ? null : e,
            startMinute: b.startMinute,
            endMinute: b.endMinute,
            requestId: b.requestId,
            note: b.note,
          },
        })
      )
    );
  }

  // A weekly rule has no per-date exception, so free a day it covers by
  // clipping the span it repeats over: the rule comes back as the piece before
  // the erased run and/or the piece after it, keeping its weekday, window and
  // note. A rule with nothing left to come goes entirely.
  const recurring = await prisma.unavailability.findMany({
    where: { userId: user.id, type: "RECURRING" },
  });
  let recurringClipped = 0;
  for (const rule of recurring) {
    const spans = clipRecurringAroundDays(
      {
        dayOfWeek: rule.dayOfWeek,
        startDate: rule.startDate ? ymd(rule.startDate) : null,
        endDate: rule.endDate ? ymd(rule.endDate) : null,
      },
      ymd(start),
      ymd(end)
    );
    if (!spans) continue; // doesn't cover any of these days
    recurringClipped++;
    ops.push(
      prisma.unavailability.delete({ where: { id: rule.id } }),
      ...spans.map((span) =>
        prisma.unavailability.create({
          data: {
            userId: user.id,
            type: "RECURRING",
            dayOfWeek: rule.dayOfWeek,
            startMinute: rule.startMinute,
            endMinute: rule.endMinute,
            startDate: span.startDate ? parseLocalDate(span.startDate) : null,
            endDate: span.endDate ? parseLocalDate(span.endDate) : null,
            requestId: rule.requestId,
            note: rule.note,
          },
        })
      )
    );
  }

  if (ops.length > 0) await prisma.$transaction(ops);

  return NextResponse.json({ ok: true, recurringClipped });
}
