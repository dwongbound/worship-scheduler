// Minimal iCalendar (.ics) generation — pure functions, unit-tested in
// tests/unit/ics.test.ts. Hand-rolled instead of a dependency because we
// only need simple VEVENTs; RFC 5545 is easy to satisfy for this subset.

import { INSTRUMENT_LABELS, ROLE_ORDER, type Instrument } from "./constants";

/**
 * The calendar title for a set: its name followed by one "(Role)" per role
 * the person plays on it, e.g. "Thursday Night Set (Acoustic Guitar)". Roles
 * are de-duplicated and shown in ROLE_ORDER so the title is stable. Every
 * .ics export routes through this so titles are identical no matter the
 * trigger (whole-calendar export or a single-set export).
 */
export function setEventTitle(
  label: string | null | undefined,
  roles: Instrument[]
): string {
  const base = label?.trim() || "Worship Set";
  const parens = ROLE_ORDER.filter((r) => roles.includes(r))
    .map((r) => `(${INSTRUMENT_LABELS[r]})`)
    .join(" ");
  return parens ? `${base} ${parens}` : base;
}

export interface IcsEvent {
  id: string; // becomes the UID (must be stable per event)
  title: string;
  description?: string;
  start: Date;
  durationMinutes: number;
}

/**
 * The timezone exported events are anchored to. Defaults to the app's configured
 * zone (the same one set times are interpreted in — see instrumentation.ts) so
 * events land at their real local wall-clock time in every calendar, instead of
 * reading as UTC/GMT. APP_TZ wins because on Vercel `TZ` is reserved.
 */
export function appTimeZone(): string {
  return process.env.APP_TZ || process.env.TZ || "America/Los_Angeles";
}

/** Format a Date as an ICS UTC timestamp: 20260105T190000Z (used for DTSTAMP). */
export function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// The wall-clock date/time parts of an instant in a given IANA timezone.
function zonedParts(instant: Date, timeZone: string): Record<string, string> {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(instant).map((x) => [x.type, x.value])
  ) as Record<string, string>;
  // Some engines emit "24" for midnight; normalize to "00".
  return { ...p, hour: p.hour === "24" ? "00" : p.hour };
}

/** "YYYYMMDDTHHMMSS" — an instant's local wall-clock in `timeZone` (no Z). */
export function formatLocalIcsDate(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
}

// UTC offset (minutes east of UTC) that `timeZone` observes at `instant`.
function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUTC = Date.UTC(
    +p.year,
    +p.month - 1,
    +p.day,
    +p.hour,
    +p.minute,
    +p.second
  );
  return Math.round((asUTC - instant.getTime()) / 60000);
}

// A UTC offset as an ICS field value: +HHMM / -HHMM.
function icsOffset(mins: number): string {
  const sign = mins < 0 ? "-" : "+";
  const abs = Math.abs(mins);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}${mm}`;
}

// "YYYYMMDDTHHMMSS" for an instant seen through a fixed offset — used for a
// VTIMEZONE observance's DTSTART, which is local time in the *prior* offset.
function formatWithOffset(instant: Date, offsetMin: number): string {
  return new Date(instant.getTime() + offsetMin * 60000)
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "");
}

// The first instant in (lo, hi] where `timeZone`'s offset changes, else null.
function nextTransition(lo: Date, hi: Date, timeZone: string): Date | null {
  const offLo = tzOffsetMinutes(lo, timeZone);
  if (offLo === tzOffsetMinutes(hi, timeZone)) return null;
  let a = lo.getTime();
  let b = hi.getTime();
  while (b - a > 1000) {
    const mid = a + Math.floor((b - a) / 2);
    if (tzOffsetMinutes(new Date(mid), timeZone) === offLo) a = mid;
    else b = mid;
  }
  // DST changes land on a minute boundary; snap off the sub-minute search residual.
  return new Date(Math.round(b / 60000) * 60000);
}

/**
 * A VTIMEZONE component for `timeZone` covering [minYear-1 .. maxYear]. We walk
 * the span in two-week steps and binary-search each detected offset change to
 * the minute, emitting a STANDARD/DAYLIGHT observance per transition (or a
 * single STANDARD for a fixed-offset zone). Explicit per-transition DTSTARTs —
 * rather than RRULEs — keep it correct for any zone without hardcoding DST rules.
 */
function buildVTimeZone(
  timeZone: string,
  minYear: number,
  maxYear: number
): string[] {
  const start = new Date(Date.UTC(minYear - 1, 0, 1));
  const end = new Date(Date.UTC(maxYear + 1, 0, 1));
  const STEP = 14 * 24 * 60 * 60 * 1000;

  const transitions: { at: Date; from: number; to: number }[] = [];
  let cursor = start;
  while (cursor < end) {
    const next = new Date(Math.min(cursor.getTime() + STEP, end.getTime()));
    const at = nextTransition(cursor, next, timeZone);
    if (at) {
      transitions.push({
        at,
        from: tzOffsetMinutes(new Date(at.getTime() - 60000), timeZone),
        to: tzOffsetMinutes(at, timeZone),
      });
    }
    cursor = next;
  }

  const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
  if (transitions.length === 0) {
    const off = icsOffset(tzOffsetMinutes(start, timeZone));
    lines.push(
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${off}`,
      `TZOFFSETTO:${off}`,
      "END:STANDARD"
    );
  } else {
    for (const t of transitions) {
      const daylight = t.to > t.from; // spring forward = start of DST
      lines.push(
        daylight ? "BEGIN:DAYLIGHT" : "BEGIN:STANDARD",
        `DTSTART:${formatWithOffset(t.at, t.from)}`,
        `TZOFFSETFROM:${icsOffset(t.from)}`,
        `TZOFFSETTO:${icsOffset(t.to)}`,
        daylight ? "END:DAYLIGHT" : "END:STANDARD"
      );
    }
  }
  lines.push("END:VTIMEZONE");
  return lines;
}

/** Escape characters that are special in ICS text values. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Build a complete VCALENDAR document from a list of events. Times are anchored
 * to `timeZone` (default: the app's zone) via a VTIMEZONE + TZID-qualified
 * DTSTART/DTEND, so calendars show each event at its real local wall-clock time
 * rather than in UTC/GMT.
 */
export function buildIcs(
  events: IcsEvent[],
  calendarName = "Worship Scheduler",
  timeZone: string = appTimeZone()
): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Worship Scheduler//EN",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    `X-WR-TIMEZONE:${timeZone}`,
  ];

  // One VTIMEZONE for the whole file, spanning the years the events fall in.
  if (events.length > 0) {
    const years = events.flatMap((e) => {
      const end = new Date(e.start.getTime() + e.durationMinutes * 60 * 1000);
      return [
        +formatLocalIcsDate(e.start, timeZone).slice(0, 4),
        +formatLocalIcsDate(end, timeZone).slice(0, 4),
      ];
    });
    lines.push(...buildVTimeZone(timeZone, Math.min(...years), Math.max(...years)));
  }

  for (const event of events) {
    const end = new Date(
      event.start.getTime() + event.durationMinutes * 60 * 1000
    );
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@worship-scheduler`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART;TZID=${timeZone}:${formatLocalIcsDate(event.start, timeZone)}`,
      `DTEND;TZID=${timeZone}:${formatLocalIcsDate(end, timeZone)}`,
      `SUMMARY:${escapeIcsText(event.title)}`
    );
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  // RFC 5545 requires CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
