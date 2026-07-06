// Pure helpers for the "how many sets am I on" stats widget.
// Unit-tested in tests/unit/stats.test.ts.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The selectable windows on the Calendar tab.
export const STAT_WINDOWS = [
  { label: "1 week", days: 7 },
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
] as const;

/**
 * Count how many of the given set start times fall within the next
 * `days` days from `now` (inclusive of now, exclusive of past sets).
 */
export function countSetsInWindow(
  setStartTimes: Date[],
  days: number,
  now: Date = new Date()
): number {
  const windowEnd = now.getTime() + days * MS_PER_DAY;
  return setStartTimes.filter((t) => {
    const time = t.getTime();
    return time >= now.getTime() && time <= windowEnd;
  }).length;
}

// Presets for the team stats range selector (Users tab). A positive `days`
// means the window looks forward from now; a negative one looks back into the
// past. A `null` value is the "Custom range" option (user picks two dates).
export const STAT_RANGES = [
  { label: "Next week", days: 7 },
  { label: "Next 2 weeks", days: 14 },
  { label: "Next 4 weeks", days: 28 },
  { label: "Next 2 months", days: 60 },
  { label: "Next 3 months", days: 90 },
  { label: "Past year", days: -365 },
  { label: "Custom range…", days: null },
] as const;

/**
 * Turn a signed day count into an absolute [start, end] range around `now`.
 * Forward windows (days >= 0) run now → future; backward ones run past → now.
 */
export function rangeForDays(
  days: number,
  now: Date = new Date()
): { start: Date; end: Date } {
  const other = new Date(now.getTime() + days * MS_PER_DAY);
  return days >= 0 ? { start: now, end: other } : { start: other, end: now };
}
