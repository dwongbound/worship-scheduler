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
  });
}

/** 1140 → "7:00 PM" (locale-dependent). */
export function minutesToTimeLabel(minutes: number): string {
  const d = new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "19:00" (from an <input type=time>) → 1140 minutes from midnight. */
export function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}
