// Pure availability-block logic, shared by the /schedule page's date-picker
// dots and its submit-confirmation modal. Kept out of the page component so it
// can be unit-tested (tests/unit/availability.test.ts).
import { toYmd } from "@/lib/dates";
import type { ApiUnavailability } from "@/lib/types";

// A day with no time window on it is "all day" — 24h in minutes-from-midnight.
export const FULL_DAY_MIN = 24 * 60;

// Midnight of the calendar day `value` (an ISO instant) falls on, locally.
function startOfLocalDay(value: string | Date): Date {
  const d = new Date(value);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Is `date` inside the window a weekly rule repeats over? A recurring block may
 * carry a startDate (the first day it repeats) and/or an endDate (the last);
 * either being null means it's open-ended on that side, so a block with neither
 * repeats forever. Weekday matching is the caller's job.
 */
function withinRecurringWindow(e: ApiUnavailability, date: Date): boolean {
  if (e.startDate && date < startOfLocalDay(e.startDate)) return false;
  if (e.endDate && date > startOfLocalDay(e.endDate)) return false;
  return true;
}

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
      // Recurring blocks apply to every date on their weekday, inside their
      // optional [startDate, endDate] window (the first and last days they
      // repeat; null on either end = open-ended that way).
      if (date.getDay() !== e.dayOfWeek) continue;
      if (!withinRecurringWindow(e, date)) continue;
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
 * Does a WEEKLY repeat cover this day? Worth marking on its own: a repeat
 * can't be cleared for a single date (you have to delete the rule), so a day
 * blocked by one behaves differently from a day blocked by hand. Drives the
 * hatch on the week strip, the same distinction the calendar's ↻ makes.
 */
export function dayIsRepeating(
  entries: ApiUnavailability[],
  ymd: string
): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return entries.some(
    (e) =>
      e.type === "RECURRING" &&
      date.getDay() === e.dayOfWeek &&
      withinRecurringWindow(e, date)
  );
}

/**
 * Does any DATED block (one date or a range, whatever its time window) cover
 * this day? Dated blocks are the specific statement, so they WIN over the
 * weekly pattern underneath: a day with one renders as an ordinary block — red
 * "All day" over the repeat, no hatch, no ↻.
 */
export function dayHasDatedBlock(
  entries: ApiUnavailability[],
  ymd: string
): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return entries.some((e) => {
    if (e.type === "RECURRING" || !e.startDate) return false;
    const s = new Date(e.startDate);
    const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const eRaw = e.endDate ? new Date(e.endDate) : s;
    const endDay = new Date(eRaw.getFullYear(), eRaw.getMonth(), eRaw.getDate());
    return date >= startDay && date <= endDay;
  });
}

/**
 * The days an all-day DATED block covers — the ones a click/tap CLEARS instead
 * of blocking. That's the whole toggle: clicking a free or part-blocked day
 * blocks it all day, clicking one that's already blocked all day by hand frees
 * it completely (every dated block AND any weekly repeat under it).
 *
 * Weekly rules deliberately don't count here: a day that's red from a repeat
 * alone still takes a dated all-day block on the first click, which is what
 * puts a plain red "All day" over the hatch.
 */
export function allDayBlockedDays(entries: ApiUnavailability[]): Set<string> {
  const days = new Set<string>();
  for (const e of entries) {
    if (e.type === "RECURRING" || !e.startDate) continue;
    const start = e.startMinute ?? 0;
    const end = e.endMinute ?? FULL_DAY_MIN;
    // Legacy DATE_RANGE rows carry no window, so they're always all-day.
    if (e.type !== "DATE_RANGE" && !(start <= 0 && end >= FULL_DAY_MIN)) continue;
    for (const day of daysOfEntry(e)) days.add(day);
  }
  return days;
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
// a left click/drag on the calendar creates.
function isAllDaySpecific(e: ApiUnavailability): boolean {
  if (e.type !== "SPECIFIC" || !e.startDate) return false;
  const s = e.startMinute ?? 0;
  const en = e.endMinute ?? FULL_DAY_MIN;
  return s <= 0 && en >= FULL_DAY_MIN;
}

// Any DATED block, whatever its time window. Clearing days ("I'm free all of
// these" — the right-click gesture) sweeps every one of these, unlike blocking,
// which only ever deals in all-day blocks.
function isDated(e: ApiUnavailability): boolean {
  return (e.type === "SPECIFIC" || e.type === "DATE_RANGE") && !!e.startDate;
}

// ── Freeing a day a WEEKLY rule covers ─────────────────────────────────────
// A recurring rule has no per-date exception in the schema, so "this day is
// free" is said by CLIPPING the span it repeats over: the rule becomes the
// piece before the freed run plus the piece after it (usually just one of the
// two). Shared by the calendar's optimistic edit below and by
// /api/availability/block-days, so a hold on a day does the same thing in both.

/** The span a weekly rule repeats over, as YYYY-MM-DD bounds (null = open). */
export interface RecurringSpan {
  startDate: string | null;
  endDate: string | null;
}

// "YYYY-MM-DD" n days away. Lexicographic order on these strings IS date order,
// which is what every comparison below leans on.
function shiftYmd(value: string, days: number): string {
  const d = parseYmd(value);
  d.setDate(d.getDate() + days);
  return toYmd(d);
}

// Does `dayOfWeek` land inside [from, to]? A null `to` is open-ended that way,
// so the next occurrence always counts.
function weekdayFalls(dayOfWeek: number, from: string, to: string | null): boolean {
  const d = parseYmd(from);
  d.setDate(d.getDate() + ((dayOfWeek - d.getDay() + 7) % 7)); // first one
  return to === null || toYmd(d) <= to;
}

/**
 * Clip a weekly rule so [startYmd, endYmd] comes out FREE, returning the spans
 * that survive — 0, 1 or 2 of them — or null when the rule never touched those
 * days, meaning there's nothing to do.
 *
 * A surviving piece whose last occurrence is already in the past is dropped
 * rather than kept as a spent row: freeing next Monday on an open-ended "every
 * Monday" leaves "Mondays from the week after", not that plus a dead "Mondays
 * until last week".
 */
export function clipRecurringAroundDays(
  rule: {
    dayOfWeek: number | null;
    startDate: string | null;
    endDate: string | null;
  },
  startYmd: string,
  endYmd: string,
  today = new Date()
): RecurringSpan[] | null {
  const dow = rule.dayOfWeek;
  if (dow == null) return null;
  // Where the freed run and the rule's own span overlap — if the weekday never
  // lands in there, this rule isn't what's blocking those days.
  const lo = rule.startDate && rule.startDate > startYmd ? rule.startDate : startYmd;
  const hi = rule.endDate && rule.endDate < endYmd ? rule.endDate : endYmd;
  if (lo > hi || !weekdayFalls(dow, lo, hi)) return null;

  const spans: RecurringSpan[] = [];
  const before = shiftYmd(startYmd, -1);
  if (!rule.startDate || rule.startDate <= before) {
    spans.push({ startDate: rule.startDate, endDate: before });
  }
  const after = shiftYmd(endYmd, 1);
  if (!rule.endDate || rule.endDate >= after) {
    spans.push({ startDate: after, endDate: rule.endDate });
  }
  const todayYmd = toYmd(today);
  return spans.filter((span) => {
    // Measure from today, never from a start date that's already gone by.
    const from =
      span.startDate && span.startDate > todayYmd ? span.startDate : todayYmd;
    if (span.endDate && from > span.endDate) return false;
    return weekdayFalls(dow, from, span.endDate);
  });
}

// Optimistic (not-yet-saved) entries carry a throwaway id with this prefix so
// the UI can tell them apart from real DB rows — e.g. to keep their Delete
// button disabled until the reload swaps in the real id.
export const OPTIMISTIC_ID_PREFIX = "optimistic-";
export function isOptimisticId(id: string): boolean {
  return id.startsWith(OPTIMISTIC_ID_PREFIX);
}

let optimisticCounter = 0;
// Build a synthetic entry for [startYmd, endYmd]. All-day SPECIFIC by default;
// pass `like` to inherit an existing block's type, time window and note, which
// is what keeps a split morning block a morning block. The `id` is a throwaway
// (unique for React keys); the reload replaces it with the real row.
function synthBlock(
  startYmd: string,
  endYmd: string,
  requestId: string | null,
  like?: ApiUnavailability
): ApiUnavailability {
  if (like) {
    return {
      id: `${OPTIMISTIC_ID_PREFIX}${optimisticCounter++}`,
      type: like.type,
      dayOfWeek: null,
      startMinute: like.startMinute,
      endMinute: like.endMinute,
      startDate: parseYmd(startYmd).toISOString(),
      endDate: startYmd === endYmd ? null : parseYmd(endYmd).toISOString(),
      requestId,
      note: like.note,
    };
  }
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

// Build a synthetic weekly rule: `like`'s weekday, time window and note over a
// new span — what a clipped recurring rule looks like before the reload brings
// back the real rows.
function synthRecurring(
  like: ApiUnavailability,
  span: RecurringSpan
): ApiUnavailability {
  return {
    id: `${OPTIMISTIC_ID_PREFIX}${optimisticCounter++}`,
    type: "RECURRING",
    dayOfWeek: like.dayOfWeek,
    startMinute: like.startMinute,
    endMinute: like.endMinute,
    startDate: span.startDate ? parseYmd(span.startDate).toISOString() : null,
    endDate: span.endDate ? parseYmd(span.endDate).toISOString() : null,
    requestId: like.requestId,
    note: like.note,
  };
}

/**
 * Apply a whole-day block (`blocked`) or a full clear (`!blocked`) of
 * [startYmd, endYmd] to `entries`, returning a NEW array — the same merge/split
 * the block-days endpoint performs, so the optimistic calendar matches what the
 * server will save (no flash on reload). Returns the original array unchanged
 * when there's nothing to do.
 *
 * Blocking only ever creates all-day blocks; clearing removes every dated block
 * on those days, whatever its time window, AND clips any weekly rule covering
 * them so the days really do come out free. `today` is injectable only so the
 * clipping is testable (it decides which clipped piece is already spent).
 */
export function applyDayEdit(
  entries: ApiUnavailability[],
  startYmd: string,
  endYmd: string,
  blocked: boolean,
  today = new Date()
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

  // Clear: sweep EVERY dated block off the target days — partial-day ones
  // included — splitting each around the days it still covers and preserving
  // its window, requestId and note. A weekly rule can't be left standing or the
  // day wouldn't be free, so it's CLIPPED around the run instead (see
  // clipRecurringAroundDays).
  const dated = entries.filter(isDated);
  const untouchable = entries.filter(
    (e) => !isDated(e) && e.type !== "RECURRING"
  );
  const survivors: ApiUnavailability[] = [];
  for (const r of entries) {
    if (r.type !== "RECURRING") continue;
    const spans = clipRecurringAroundDays(
      {
        dayOfWeek: r.dayOfWeek,
        startDate: r.startDate ? toYmd(new Date(r.startDate)) : null,
        endDate: r.endDate ? toYmd(new Date(r.endDate)) : null,
      },
      startYmd,
      endYmd,
      today
    );
    if (spans === null) survivors.push(r); // doesn't touch these days
    else for (const span of spans) survivors.push(synthRecurring(r, span));
  }
  for (const b of dated) {
    const days = daysOfEntry(b);
    const kept = new Set(days.filter((d) => !targetDays.has(d)));
    if (kept.size === days.length) {
      survivors.push(b); // untouched
      continue;
    }
    for (const [s, e] of rangesFromDays(kept)) {
      survivors.push(synthBlock(s, e, b.requestId, b));
    }
  }
  return [...untouchable, ...survivors];
}

// One weekly recurring block: a weekday plus a time-of-day window, and
// optionally the days it repeats between ("YYYY-MM-DD"; null on either end =
// open-ended that way, so both null = forever).
export interface RecurringBlock {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
  startDate: string | null;
  endDate: string | null;
}

// The span a set of recurring blocks repeats over, as the form collects it.
export interface RecurringRange {
  startDate?: string | null; // first day it repeats (null = from now on)
  endDate?: string | null; // last day it repeats (null = forever)
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
 * five blocks (the two windows merge into one). The `range` (the first and last
 * days they repeat) rides along on every block.
 */
export function expandRecurringBlocks(
  days: number[],
  windows: { startMinute: number; endMinute: number }[],
  range: RecurringRange = {}
): RecurringBlock[] {
  const merged = mergeWindows(windows);
  const startDate = range.startDate ?? null;
  const endDate = range.endDate ?? null;
  return [...days]
    .sort((a, b) => a - b)
    .flatMap((dayOfWeek) =>
      merged.map((w) => ({ dayOfWeek, ...w, startDate, endDate }))
    );
}
