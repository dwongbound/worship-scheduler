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

/** Format a Date as an ICS UTC timestamp: 20260105T190000Z */
export function formatIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Escape characters that are special in ICS text values. */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Build a complete VCALENDAR document from a list of events. */
export function buildIcs(
  events: IcsEvent[],
  calendarName = "Worship Scheduler"
): string {
  const now = new Date();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Worship Scheduler//EN",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ];

  for (const event of events) {
    const end = new Date(
      event.start.getTime() + event.durationMinutes * 60 * 1000
    );
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id}@worship-scheduler`,
      `DTSTAMP:${formatIcsDate(now)}`,
      `DTSTART:${formatIcsDate(event.start)}`,
      `DTEND:${formatIcsDate(end)}`,
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
