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
 * Does a weekly rule apply on `date`, bounds and exceptions considered? A
 * recurring block may carry a startDate (the first day it repeats) and/or an
 * endDate (the last); either being null means it's open-ended on that side, so
 * a block with neither repeats forever. `exceptDates` then punches individual
 * days back out. Weekday matching is the caller's job.
 */
function withinRecurringWindow(e: ApiUnavailability, date: Date): boolean {
  if (e.startDate && date < startOfLocalDay(e.startDate)) return false;
  if (e.endDate && date > startOfLocalDay(e.endDate)) return false;
  // A date freed from the calendar is a hole in the pattern, not the end of it.
  return !recurringSkips(e, toYmd(date));
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

/**
 * Does weekly rule `outer` say everything `inner` does — same weekday, a time
 * window at least as wide, and a span at least as long? Two weekly rules where
 * one covers the other are an overlap worth collapsing: the narrower row adds
 * nothing to the list but noise ("every Tuesday 6a–5p" under "every Tuesday,
 * all day"). Exceptions are deliberately not weighed: a hole in `outer` is a
 * hole in what it says, and the caller decides what to do about it.
 */
export function recurringCovers(
  outer: RecurringRuleish & { startMinute?: number | null; endMinute?: number | null },
  inner: RecurringRuleish & { startMinute?: number | null; endMinute?: number | null }
): boolean {
  if (outer.dayOfWeek == null || outer.dayOfWeek !== inner.dayOfWeek) return false;
  // Window: outer starts no later and ends no earlier.
  if ((outer.startMinute ?? 0) > (inner.startMinute ?? 0)) return false;
  if ((outer.endMinute ?? FULL_DAY_MIN) < (inner.endMinute ?? FULL_DAY_MIN)) {
    return false;
  }
  // Span: a null bound is open-ended, so it covers any date on that side.
  if (outer.startDate && (!inner.startDate || inner.startDate < outer.startDate)) {
    return false;
  }
  if (outer.endDate && (!inner.endDate || inner.endDate > outer.endDate)) {
    return false;
  }
  return true;
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
// A weekly rule is a pattern, so freeing one date is an EXCEPTION to it:
// `exceptDates` (YYYY-MM-DD) on the row, one per freed day. Splitting the span
// instead would turn one "every Tuesday" into two rows per freed date, and
// freeing a day covered by three overlapping Tuesday rules would leave six —
// which is the state this replaced. An exception also makes overlaps behave:
// each rule covering the day gets the same date, so the day really is free,
// and the rules stay recognisable (and so stay DUPLICATES of a re-added
// identical rule, rather than new distinct spans).

/** A weekly rule, as little of one as any of this needs to know. */
export interface RecurringRuleish {
  dayOfWeek: number | null;
  startDate: string | null; // YYYY-MM-DD, null = open-ended that way
  endDate: string | null;
  exceptDates?: string[] | null;
}

/** Is `ymd` one of the dates this rule has been told to skip? */
export function recurringSkips(
  rule: { exceptDates?: string[] | null },
  ymd: string
): boolean {
  return !!rule.exceptDates?.includes(ymd);
}

/**
 * Which of `days` (YYYY-MM-DD) this weekly rule actually blocks — the dates
 * that have to become exceptions for those days to come out free. Empty when
 * the rule has nothing to do with them (wrong weekday, outside its span, or
 * already skipped), which is the signal to leave the row alone.
 */
export function recurringExceptionsFor(
  rule: RecurringRuleish,
  days: Iterable<string>
): string[] {
  const dow = rule.dayOfWeek;
  if (dow == null) return [];
  const out: string[] = [];
  for (const ymd of days) {
    if (parseYmd(ymd).getDay() !== dow) continue;
    if (rule.startDate && ymd < rule.startDate) continue;
    if (rule.endDate && ymd > rule.endDate) continue;
    if (recurringSkips(rule, ymd)) continue; // already free
    out.push(ymd);
  }
  return out;
}

/**
 * The exceptions a rule should carry after freeing `added`: the ones it has
 * plus the new ones, sorted, with dates it can never fire on again dropped —
 * anything before `today`, or outside the span it repeats over. Without that
 * prune the list would only ever grow, and a rule bounded to one month would
 * carry exceptions for days it stopped covering long ago.
 */
export function mergeExceptions(
  rule: RecurringRuleish,
  added: string[],
  today = new Date()
): string[] {
  const todayYmd = toYmd(today);
  const keep = new Set<string>();
  for (const ymd of [...(rule.exceptDates ?? []), ...added]) {
    if (ymd < todayYmd) continue; // spent
    if (rule.startDate && ymd < rule.startDate) continue;
    if (rule.endDate && ymd > rule.endDate) continue;
    keep.add(ymd);
  }
  return [...keep].sort();
}

// The YYYY-MM-DD bounds of a stored rule, for the helpers above (they compare
// day strings; the row keeps ISO instants).
export function ruleBounds(e: ApiUnavailability): RecurringRuleish {
  return {
    dayOfWeek: e.dayOfWeek,
    startDate: e.startDate ? toYmd(new Date(e.startDate)) : null,
    endDate: e.endDate ? toYmd(new Date(e.endDate)) : null,
    exceptDates: e.exceptDates ?? null,
  };
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
 * exception prune is testable (it drops dates that can never fire again).
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
  // day wouldn't be free either, so every rule covering one of these days takes
  // the date as an EXCEPTION — the row stays, with a hole in it.
  const dated = entries.filter(isDated);
  const untouchable = entries.filter(
    (e) => !isDated(e) && e.type !== "RECURRING"
  );
  const survivors: ApiUnavailability[] = [];
  for (const r of entries) {
    if (r.type !== "RECURRING") continue;
    const bounds = ruleBounds(r);
    const added = recurringExceptionsFor(bounds, targetDays);
    if (added.length === 0) survivors.push(r); // doesn't block these days
    else survivors.push({ ...r, exceptDates: mergeExceptions(bounds, added, today) });
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
