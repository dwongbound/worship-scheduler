// Date helpers shared by the schedule generator and the UI.
// upcomingOccurrences is pure + unit-tested (tests/unit/dates.test.ts).

/**
 * Expand a weekly recurrence into concrete Dates for the next `weeks`
 * weeks. E.g. (dayOfWeek=1, startMinute=1140) → the next N Mondays at 7pm,
 * in the server's local timezone. Occurrences already in the past
 * (earlier today) are skipped.
 */
export function upcomingOccurrences(
  dayOfWeek: number,
  startMinute: number,
  weeks: number,
  from: Date = new Date()
): Date[] {
  // Find the first matching day-of-week on or after `from`'s date.
  const first = new Date(from);
  first.setHours(0, 0, 0, 0);
  const delta = (dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + delta);

  const occurrences: Date[] = [];
  for (let week = 0; week < weeks; week++) {
    const d = new Date(first);
    d.setDate(first.getDate() + week * 7);
    d.setMinutes(startMinute); // JS normalizes 450 min → 07:30
    if (d.getTime() <= from.getTime()) continue; // skip earlier today
    occurrences.push(d);
  }
  return occurrences;
}

/**
 * Expand a weekly recurrence into the concrete Dates that fall within an
 * explicit [from, to] window (inclusive), in the server's local timezone.
 * Same shape as upcomingOccurrences but bounded by real dates instead of a
 * week count — used when an admin generates for a specific date range.
 */
export function occurrencesInRange(
  dayOfWeek: number,
  startMinute: number,
  from: Date,
  to: Date
): Date[] {
  // First matching day-of-week on or after `from`'s date.
  const first = new Date(from);
  first.setHours(0, 0, 0, 0);
  const delta = (dayOfWeek - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + delta);

  const occurrences: Date[] = [];
  const d = new Date(first);
  d.setMinutes(startMinute); // JS normalizes 450 min → 07:30
  while (d.getTime() <= to.getTime()) {
    if (d.getTime() >= from.getTime()) occurrences.push(new Date(d));
    d.setDate(d.getDate() + 7);
  }
  return occurrences;
}

/**
 * Parse a "YYYY-MM-DD" string (from a date picker) as LOCAL midnight — never
 * UTC, so the calendar day doesn't shift for US timezones. Returns null on
 * anything unparseable. This is the single source of truth for the app's
 * date-string parsing (server routes + client), since recurring/stored dates
 * are all interpreted in the server's local timezone.
 */
export function parseLocalDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return isNaN(date.getTime()) ? null : date;
}

/** A short "7/8/26" style label for a date (or ISO string). */
export function shortDateLabel(value: Date | string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
}

// ── Display formatting (client-safe) ────────────────────────────────────

export function formatDay(value: Date | string): string {
  return new Date(value).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true, // always AM/PM, never 24-hour, regardless of locale
  });
}

/** 1140 → "7:00 PM". Always AM/PM (12-hour), regardless of the viewer locale. */
export function minutesToTimeLabel(minutes: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "19:00" (from an <input type=time>) → 1140 minutes from midnight. */
export function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
