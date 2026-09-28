// Geometry for the stepping calendar in components/common/DateSelect.
//
// The picker shows a fixed window of five week rows — seven columns, days
// running straight through a month boundary (…Sep 29, 30, Oct 1, 2…), with no
// per-month grids and no padding cells. Moving through time shifts that window
// by WHOLE WEEKS, one at a time: the numbers step down a row and nothing else
// moves, so no part of the calendar slides against another.
//
// There is no scroll container. The window is just an index into an endless
// run of weeks, which is what keeps a scrollbar from ever appearing and makes
// "one week per gesture" exact rather than approximate.
//
// The month heading is therefore a question about what's ON SCREEN: it names
// whichever month owns most of the five visible rows, so it flips only once
// the majority of the view is in the next month.
//
// All of it is pure and unit-tested (tests/unit/calendarScroll.test.ts).

export const DAYS_IN_WEEK = 7;

/** How many week rows the date PICKER shows at once. */
export const VISIBLE_WEEKS = 5;

/**
 * How many the calendar TAB's grid shows. Six, not five, because a month can
 * span six week rows (a 31-day month starting on a Saturday) and that page's
 * job is to show you a month — the picker's is to fit in a popup. Stepping is
 * identical either way; only the window's height differs.
 */
export const CALENDAR_VISIBLE_WEEKS = 6;

/**
 * Shortest gap between two steps, in ms. A trackpad fires wheel events in the
 * dozens per second and momentum keeps them coming after your fingers lift —
 * without a floor, one flick would fly through a year.
 */
export const STEP_COOLDOWN_MS = 150;

/**
 * Finger travel that counts as one week, in px. Shared by the date picker and
 * the calendar tab's grid so a swipe means the same thing in both.
 */
export const SWIPE_STEP_PX = 24;

/** Local midnight, so week/month maths never drifts on a DST boundary. */
function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The Sunday of the week `d` falls in. Weeks start on Sunday, as the grid does. */
export function startOfWeek(d: Date): Date {
  const out = midnight(d);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

/** First of the month `d` falls in. */
export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** "2026-09" — identifies a month for comparison and for React keys. */
export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** `n` weeks after `from` (negative goes back). */
export function addWeeks(from: Date, n: number): Date {
  const d = midnight(from);
  d.setDate(d.getDate() + n * DAYS_IN_WEEK);
  return d;
}

/** Whole weeks from `a` to `b`, negative when `b` is earlier. */
export function weeksBetween(a: Date, b: Date): number {
  const ms = startOfWeek(b).getTime() - startOfWeek(a).getTime();
  return Math.round(ms / (DAYS_IN_WEEK * 24 * 60 * 60 * 1000));
}

/**
 * `count` consecutive week-start Dates beginning at `from` (snapped to its
 * week). These are the grid's rows, oldest first.
 */
export function buildWeeks(from: Date, count: number): Date[] {
  const start = startOfWeek(from);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i * DAYS_IN_WEEK);
    return d;
  });
}

/** The seven days of one week row, Sunday first. */
export function weekDays(weekStart: Date): Date[] {
  const start = midnight(weekStart);
  return Array.from({ length: DAYS_IN_WEEK }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/**
 * The top row of the window when the picker opens on `day`.
 *
 * Normally the month's own first week, so you see the month from its start.
 * When `day` sits too late in the month to fit in the window that way (a long
 * month beginning late in a week), the window slides down just enough to keep
 * that day on the last row — opening on a date you can't see would be worse
 * than opening a row or two into the month.
 */
export function openingWeek(day: Date): Date {
  const fromMonthStart = startOfWeek(startOfMonth(day));
  const rowsIn = weeksBetween(fromMonthStart, day);
  return rowsIn < VISIBLE_WEEKS
    ? fromMonthStart
    : addWeeks(startOfWeek(day), -(VISIBLE_WEEKS - 1));
}

/**
 * The top row of a window with `day`'s week in the MIDDLE — where "go to this
 * date" should land you. `openingWeek` starts at a month's first week, which
 * is right for opening onto a month but wrong for jumping to a single day: a
 * day late in the month would sit on the bottom row, or not move the window at
 * all if it was already showing.
 */
export function centredWeek(day: Date): Date {
  return addWeeks(startOfWeek(day), -Math.floor(VISIBLE_WEEKS / 2));
}

/**
 * The month owning the most days across `weeks` — what the heading should
 * read, and which days render at full strength. Ties go to the EARLIER month,
 * so the heading changes only once the next month is genuinely in the
 * majority, never at a 50/50 split.
 *
 * Returns the first of that month, or null when there are no weeks.
 */
export function majorityMonth(weeks: Date[]): Date | null {
  const tally = new Map<string, { month: Date; days: number }>();
  for (const week of weeks) {
    for (const day of weekDays(week)) {
      const key = monthKey(day);
      const row = tally.get(key) ?? { month: startOfMonth(day), days: 0 };
      row.days++;
      tally.set(key, row);
    }
  }
  let winner: { month: Date; days: number } | null = null;
  for (const row of tally.values()) {
    // Strictly greater, walking oldest-first, so a tie keeps the earlier month.
    if (!winner || row.days > winner.days) winner = row;
  }
  return winner?.month ?? null;
}

/**
 * Is a step allowed yet? `last` is when the previous one happened (0 = never).
 * Pure so the rate limit is testable without faking wheel events.
 */
export function canStep(
  now: number,
  last: number,
  cooldown = STEP_COOLDOWN_MS
): boolean {
  return now - last >= cooldown;
}

/**
 * The earliest day a calendar window should still draw at full strength.
 *
 * Today, normally. But once the window has been moved into a LATER month, the
 * 1st of that month: the tail of the previous month sitting in the top row is
 * behind where you're looking, and at full strength it competes with the month
 * you came to see. Days in later months are never dimmed — they're ahead of
 * you, and sets you can still act on.
 *
 * `headerMonth` is the month the heading names (majorityMonth's answer).
 */
export function earliestLiveDay(headerMonth: Date, today: Date): Date {
  const monthStart = startOfMonth(headerMonth);
  const todayStart = midnight(today);
  return monthStart.getTime() > todayStart.getTime() ? monthStart : todayStart;
}
