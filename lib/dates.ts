// Date helpers shared by the schedule generator and the UI.
// upcomingOccurrences is pure + unit-tested (tests/unit/dates.test.ts).
import { APP_TZ } from "./appTz";

// One Intl formatter per timezone — building one is expensive and
// isUserAvailable calls this per set, per rule, per render.
const ZONED_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = ZONED_FORMATTERS.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23", // 00–23, so midnight is 0 rather than 12 or 24
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    ZONED_FORMATTERS.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * What an instant reads as ON THE WALL CLOCK of a given timezone — the app's
 * by default.
 *
 * This is what lets the browser agree with the server about which day and hour
 * a set falls on. `getDay()`/`getHours()` answer in whatever zone the RUNTIME
 * happens to be in, which is the server's timezone on one side and the admin's
 * on the other; those are the same only by luck.
 *
 * `ymd` is a comparable calendar-day number (2026-09-19 → 20260919), so day
 * ranges compare with < and > without any more Date math.
 */
export function zonedParts(
  value: Date,
  timeZone: string = APP_TZ
): {
  year: number;
  month: number;
  day: number;
  ymd: number;
  weekday: number; // 0 = Sunday, matching Date#getDay
  minuteOfDay: number;
} {
  const parts = zonedFormatter(timeZone).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = part("year");
  const month = part("month");
  const day = part("day");
  return {
    year,
    month,
    day,
    ymd: year * 10000 + month * 100 + day,
    // Derived from the zoned Y/M/D through UTC, so the weekday is the one that
    // calendar date has — never the runtime's idea of the same instant.
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    minuteOfDay: part("hour") * 60 + part("minute"),
  };
}

/**
 * Local `yyyy-mm-dd` for a Date — the same string the native <input type=date>
 * emits. Built by hand from the local getters so we never touch UTC (new
 * Date("2026-07-07") parses as midnight UTC and can shift a day in the US).
 */
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

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

/** True when two dates fall on the same calendar day (local, time ignored). */
export function isSameDay(a: Date | string, b: Date | string): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/**
 * A short label for a date range that collapses to a single date when the
 * endpoints are the same day: "7/8/26" vs "7/8/26 - 7/10/26".
 */
export function shortRangeLabel(
  start: Date | string,
  end: Date | string
): string {
  return isSameDay(start, end)
    ? shortDateLabel(start)
    : `${shortDateLabel(start)} - ${shortDateLabel(end)}`;
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

/**
 * The verbose (`formatDay`) counterpart to `shortRangeLabel`: a single day
 * when the endpoints match, else "start → end".
 */
export function dateRangeLabel(
  start: Date | string,
  end: Date | string
): string {
  return isSameDay(start, end)
    ? formatDay(start)
    : `${formatDay(start)} → ${formatDay(end)}`;
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

/**
 * "06/03/2026 8:42 PM" — the compact stamp for a log row, where the full
 * "Saturday, September 5, 2026" spelling crowds out the message next to it.
 */
export function shortDateTimeLabel(value: Date | string): string {
  const d = new Date(value);
  const date = d.toLocaleDateString("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  });
  return `${date} ${formatTime(d)}`;
}

/**
 * 1140 → "7PM", 1170 → "7:30PM". The compact form for tight rows: on-the-hour
 * times drop ":00" and there's no space before the AM/PM.
 */
export function minutesToShortTimeLabel(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${hour12}${mins ? `:${String(mins).padStart(2, "0")}` : ""}${suffix}`;
}

/** "19:00" (from an <input type=time>) → 1140 minutes from midnight. */
export function timeStringToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Midnight on the MONDAY of the week `d` falls in. Weeks read Monday→Sunday
 * here — the way a week is planned — so a Sunday service groups with the
 * rehearsals that led up to it rather than starting a fresh week of its own.
 * (The month calendar's Sun–Sat grid is a separate thing and stays as it is.)
 */
export function startOfWeekMonday(d: Date): Date {
  // getDay() is 0=Sun…6=Sat, so Sunday is 6 days after its Monday, not 0.
  const backToMonday = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - backToMonday);
}

/**
 * 1140 → "19:00" — the value an `<input type=time>` wants. Wraps around the
 * clock (1500 → "01:00"), so an end time that lands after midnight still
 * renders as a real time of day.
 */
export function minutesToTimeInput(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/**
 * How long a set running `start` → `end` lasts, both "HH:MM". An end at or
 * before the start is read as running past midnight (22:00 → 00:30 = 150 min),
 * which is the only sensible reading for a late set.
 * Returns null when either time is unparseable or the two are identical — a
 * zero-length set is a mis-typed time, not a 24-hour one, so callers keep
 * whatever duration they had.
 */
export function durationBetween(start: string, end: string): number | null {
  const a = timeStringToMinutes(start);
  const b = timeStringToMinutes(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  return b > a ? b - a : b + 1440 - a;
}
