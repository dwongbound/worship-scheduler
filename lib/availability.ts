// Pure availability-block logic, shared by the /schedule page's date-picker
// dots and its submit-confirmation modal. Kept out of the page component so it
// can be unit-tested (tests/unit/availability.test.ts).
import { toYmd } from "@/lib/dates";
import type { ApiUnavailability } from "@/lib/types";

// A day with no time window on it is "all day" — 24h in minutes-from-midnight.
export const FULL_DAY_MIN = 24 * 60;

/**
 * How much of one calendar day is blocked, given every unavailability entry:
 *   "full"    — an all-day block covers it (a whole-day window, or a legacy
 *               DATE_RANGE, or a recurring/specific block spanning 00:00–24:00)
 *   "partial" — only a time window of the day is blocked
 *   null      — the day is free
 * "full" wins over "partial" when both kinds of block land on the same day.
 * Drives the red (full) / amber (partial) dots on the date pickers and the
 * blocked-day summary in the submit-confirmation modal.
 */
export function dayBlockLevel(
  entries: ApiUnavailability[],
  ymd: string
): "full" | "partial" | null {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  let full = false;
  let partial = false;
  for (const e of entries) {
    if (e.type === "RECURRING") {
      // Recurring blocks apply to every date on their weekday, up to their
      // optional endDate (the last day they repeat; null = forever).
      if (date.getDay() !== e.dayOfWeek) continue;
      if (e.endDate) {
        const stop = new Date(e.endDate);
        if (date > new Date(stop.getFullYear(), stop.getMonth(), stop.getDate())) {
          continue;
        }
      }
    } else {
      // SPECIFIC / DATE_RANGE: the date must fall in [startDate, endDate].
      if (!e.startDate) continue;
      const s = new Date(e.startDate);
      const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
      const eRaw = e.endDate ? new Date(e.endDate) : s;
      const endDay = new Date(eRaw.getFullYear(), eRaw.getMonth(), eRaw.getDate());
      if (date < startDay || date > endDay) continue;
    }
    const start = e.startMinute ?? 0;
    const end = e.endMinute ?? FULL_DAY_MIN;
    // Legacy DATE_RANGE rows carry no time window, so they're always all-day.
    if (e.type === "DATE_RANGE" || (start <= 0 && end >= FULL_DAY_MIN)) full = true;
    else partial = true;
  }
  return full ? "full" : partial ? "partial" : null;
}

/**
 * Every blocked day inside [startIso, endIso] (a request's window), with a
 * short "Wed, Jul 8" label and its full/partial level — what the
 * submit-confirmation modal lists. Days iterate in the local zone so the
 * boundaries line up with dayBlockLevel and the calendar.
 */
export function blockedDaysInRange(
  entries: ApiUnavailability[],
  startIso: string,
  endIso: string
): { ymd: string; label: string; level: "full" | "partial" }[] {
  const out: { ymd: string; label: string; level: "full" | "partial" }[] = [];
  const s = new Date(startIso);
  const e = new Date(endIso);
  const cur = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const last = new Date(e.getFullYear(), e.getMonth(), e.getDate());
  for (; cur <= last; cur.setDate(cur.getDate() + 1)) {
    const ymd = toYmd(cur);
    const level = dayBlockLevel(entries, ymd);
    if (level) {
      out.push({
        ymd,
        label: cur.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        level,
      });
    }
  }
  return out;
}

// ── Optimistic calendar edits ──────────────────────────────────────────────
// Mirrors the /api/availability/block-days server logic on the client so the
// calendar can reflect a click/drag INSTANTLY, before the request round-trips.
// Only all-day SPECIFIC blocks are merged/split (recurring + timed + legacy
// DATE_RANGE blocks are left untouched — exactly what the server does). The
// page reloads afterward to reconcile with the canonical server representation.

// Parse "YYYY-MM-DD" as local midnight (matches how the server + calendar read a
// day; UTC parsing would shift a day west).
function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Whole days a dated entry touches, as YYYY-MM-DD (endDate defaults to start).
function daysOfEntry(e: ApiUnavailability): string[] {
  if (!e.startDate) return [];
  const s = new Date(e.startDate);
  const start = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const eRaw = e.endDate ? new Date(e.endDate) : s;
  const end = new Date(eRaw.getFullYear(), eRaw.getMonth(), eRaw.getDate());
  const out: string[] = [];
  for (const d = start; d <= end; d.setDate(d.getDate() + 1)) out.push(toYmd(d));
  return out;
}

// Collapse a set of YYYY-MM-DD days into the fewest consecutive [start, end] runs.
function rangesFromDays(days: Set<string>): [string, string][] {
  const ranges: [string, string][] = [];
  for (const key of [...days].sort()) {
    const last = ranges[ranges.length - 1];
    if (last) {
      const next = parseYmd(last[1]);
      next.setDate(next.getDate() + 1);
      if (toYmd(next) === key) {
        last[1] = key; // extends the current run
        continue;
      }
    }
    ranges.push([key, key]);
  }
  return ranges;
}

// An all-day SPECIFIC block covers whole days (00:00 → 24:00) — the only kind
// click/drag on the calendar creates or clears.
function isAllDaySpecific(e: ApiUnavailability): boolean {
  if (e.type !== "SPECIFIC" || !e.startDate) return false;
  const s = e.startMinute ?? 0;
  const en = e.endMinute ?? FULL_DAY_MIN;
  return s <= 0 && en >= FULL_DAY_MIN;
}

// Optimistic (not-yet-saved) entries carry a throwaway id with this prefix so
// the UI can tell them apart from real DB rows — e.g. to keep their Delete
// button disabled until the reload swaps in the real id.
export const OPTIMISTIC_ID_PREFIX = "optimistic-";
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

let optimisticCounter = 0;
// Build a synthetic all-day SPECIFIC entry for [startYmd, endYmd]. The `id` is a
// throwaway (unique for React keys); the reload replaces it with the real row.
function synthBlock(
  startYmd: string,
  endYmd: string,
  requestId: string | null
): ApiUnavailability {
  return {
    id: `${OPTIMISTIC_ID_PREFIX}${optimisticCounter++}`,
    type: "SPECIFIC",
    dayOfWeek: null,
    startMinute: 0,
    endMinute: FULL_DAY_MIN,
    startDate: parseYmd(startYmd).toISOString(),
    endDate: startYmd === endYmd ? null : parseYmd(endYmd).toISOString(),
    requestId,
    note: null,
  };
}

/**
 * Apply a whole-day block (or unblock) of [startYmd, endYmd] to `entries`,
 * returning a NEW array — the same merge/split the block-days endpoint performs,
 * so the optimistic calendar matches what the server will save (no flash on
 * reload). Returns the original array unchanged when there's nothing to do.
 */
export function applyDayEdit(
  entries: ApiUnavailability[],
  startYmd: string,
  endYmd: string,
  blocked: boolean
): ApiUnavailability[] {
  const targetDays = new Set<string>();
  for (const d = parseYmd(startYmd); toYmd(d) <= endYmd; d.setDate(d.getDate() + 1)) {
    targetDays.add(toYmd(d));
  }
  const allDay = entries.filter(isAllDaySpecific);
  const others = entries.filter((e) => !isAllDaySpecific(e));

  if (blocked) {
    // Skip days already covered by an all-day block — no double-blocking.
    const covered = new Set<string>();
    for (const b of allDay) for (const day of daysOfEntry(b)) covered.add(day);
    const newDays = [...targetDays].filter((d) => !covered.has(d));
    if (newDays.length === 0) return entries; // nothing changes
    // Standalone (request-independent) blocks merge with the new days; blocks
    // tied to a request stay separate (the server keeps them apart too).
    const standalone = allDay.filter((b) => b.requestId == null);
    const tied = allDay.filter((b) => b.requestId != null);
    const finalDays = new Set(newDays);
    for (const b of standalone) for (const day of daysOfEntry(b)) finalDays.add(day);
    return [
      ...others,
      ...tied,
      ...rangesFromDays(finalDays).map(([s, e]) => synthBlock(s, e, null)),
    ];
  }

  // Unblock: split every overlapping all-day block around the target days,
  // preserving each block's requestId so a request-tied block stays tied.
  const survivors: ApiUnavailability[] = [];
  for (const b of allDay) {
    const days = daysOfEntry(b);
    const kept = new Set(days.filter((d) => !targetDays.has(d)));
    if (kept.size === days.length) {
      survivors.push(b); // untouched
      continue;
    }
    for (const [s, e] of rangesFromDays(kept)) {
      survivors.push(synthBlock(s, e, b.requestId));
    }
  }
  return [...others, ...survivors];
}

// One weekly recurring block: a weekday plus a time-of-day window, and
// optionally the last day it repeats ("YYYY-MM-DD"; null = forever).
export interface RecurringBlock {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  endDate: string | null;
}

/**
 * The stop date for a "repeat for N weeks" block: N weeks from today, as
 * YYYY-MM-DD. Four weeks starting today therefore covers today through the
 * same weekday four weeks out.
 */
export function weeksFromToday(weeks: number, from = new Date()): string {
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  end.setDate(end.getDate() + weeks * 7);
  return toYmd(end);
}

/**
 * Collapse overlapping or touching time windows into the fewest windows that
 * cover the same minutes — picking "Morning" and "Afternoon" together should
 * store one 6am–5pm block, not two abutting rows.
 */
export function mergeWindows(
  windows: { startMinute: number; endMinute: number }[]
): { startMinute: number; endMinute: number }[] {
  const sorted = [...windows].sort((a, b) => a.startMinute - b.startMinute);
  const merged: { startMinute: number; endMinute: number }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    // Touching counts as overlapping: 6–12 then 12–17 becomes 6–17.
    if (last && w.startMinute <= last.endMinute) {
      last.endMinute = Math.max(last.endMinute, w.endMinute);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/**
 * Expand the multi-select "Block out times" form — any number of weekdays
 * crossed with any number of time windows — into the individual recurring
 * blocks to store, one per weekday per merged window, ordered day then time.
 * "Mon–Fri mornings and afternoons" goes in as one gesture and comes out as
 * five blocks (the two windows merge into one). `endDate` (the last day they
 * repeat) rides along on every block.
 */
export function expandRecurringBlocks(
  days: number[],
  windows: { startMinute: number; endMinute: number }[],
  endDate: string | null = null
): RecurringBlock[] {
  const merged = mergeWindows(windows);
  return [...days]
    .sort((a, b) => a - b)
    .flatMap((dayOfWeek) => merged.map((w) => ({ dayOfWeek, ...w, endDate })));
}
