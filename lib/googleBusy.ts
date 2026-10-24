// Pure half of "Import from Google Calendar" on /schedule: a person's own
// Google events → the busy windows that become their blocks for one
// availability request. The Google + db half is lib/googleAvailability.ts.
//
// The rules (Dylan's, 2026-10-21):
//   • EVERY event in the request's range blocks its time — not just the times
//     sets happen. The blocks are the admin's record of when someone is free.
//   • A timed event marked "Free" (transparency: transparent) doesn't block,
//     the same as Google's own free/busy. Cancelled and declined ones don't
//     either.
//   • An ALL-DAY event blocks the whole day, Free or not — benefit of the
//     doubt. Google marks all-day events Free by default, so honouring that
//     would drop every "Vacation" on the floor.
//   • Worship sets on the calendar are NOT skipped: a request never covers
//     the window of sets already scheduled, so there's nothing to skip.
// People can still edit or delete any imported block afterwards.
import { zonedParts } from "./dates";
import { FULL_DAY_MIN } from "./availability";
import type { ApiUnavailability } from "./types";

/** The few fields of a Google Calendar event this reads — never its title. */
export interface GoogleEvent {
  id?: string;
  status?: string; // "confirmed" | "tentative" | "cancelled"
  transparency?: string; // "opaque" (default) | "transparent" (shows as Free)
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** One blocked window on one calendar day, in the app's zone. */
export interface BusyWindow {
  ymd: string; // "YYYY-MM-DD"
  startMinute: number;
  endMinute: number;
}

// "YYYY-MM-DD" ⇄ a UTC-midnight Date, purely as a calendar-day counter.
function dayOf(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function ymdOf(day: Date): string {
  return day.toISOString().slice(0, 10);
}
function nextDay(ymd: string): string {
  const d = dayOf(ymd);
  d.setUTCDate(d.getUTCDate() + 1);
  return ymdOf(d);
}
function zonedYmd(instant: Date, tz?: string): { ymd: string; minute: number } {
  const p = zonedParts(instant, tz);
  const ymd = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  return { ymd, minute: p.minuteOfDay };
}

/** Does this event take up the person's time at all? */
export function eventBlocks(event: GoogleEvent): boolean {
  if (event.status === "cancelled") return false;
  const me = event.attendees?.find((a) => a.self);
  if (me?.responseStatus === "declined") return false;
  // All-day events always block (see the header); timed ones unless Free.
  if (event.start?.date) return true;
  return event.transparency !== "transparent";
}

/** The raw per-day windows one event covers, before clamping and merging. */
export function eventWindows(event: GoogleEvent, tz?: string): BusyWindow[] {
  const out: BusyWindow[] = [];
  if (event.start?.date) {
    // All-day: end.date is EXCLUSIVE (a one-day event ends the next day).
    const last = event.end?.date ?? nextDay(event.start.date);
    for (let ymd = event.start.date; ymd < last; ymd = nextDay(ymd)) {
      out.push({ ymd, startMinute: 0, endMinute: FULL_DAY_MIN });
    }
    return out;
  }
  if (!event.start?.dateTime || !event.end?.dateTime) return out;
  const start = new Date(event.start.dateTime);
  const end = new Date(event.end.dateTime);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) return out;
  const s = zonedYmd(start, tz);
  const e = zonedYmd(end, tz);
  if (s.ymd === e.ymd) {
    out.push({ ymd: s.ymd, startMinute: s.minute, endMinute: e.minute });
    return out;
  }
  // Runs past midnight: the rest of the first day, any whole days between,
  // then the morning of the last (nothing, if it ends exactly at midnight).
  out.push({ ymd: s.ymd, startMinute: s.minute, endMinute: FULL_DAY_MIN });
  for (let ymd = nextDay(s.ymd); ymd < e.ymd; ymd = nextDay(ymd)) {
    out.push({ ymd, startMinute: 0, endMinute: FULL_DAY_MIN });
  }
  if (e.minute > 0) out.push({ ymd: e.ymd, startMinute: 0, endMinute: e.minute });
  return out;
}

/**
 * Every busy window across `events`, inside [fromYmd, toYmd] (inclusive),
 * with overlapping or touching windows on the same day merged — so a day of
 * back-to-back meetings imports as one block, not twelve. Sorted by day, then
 * time.
 */
export function busyWindows(
  events: GoogleEvent[],
  fromYmd: string,
  toYmd: string,
  tz?: string
): BusyWindow[] {
  const byDay = new Map<string, { startMinute: number; endMinute: number }[]>();
  for (const event of events) {
    if (!eventBlocks(event)) continue;
    for (const w of eventWindows(event, tz)) {
      if (w.ymd < fromYmd || w.ymd > toYmd) continue;
      if (w.endMinute <= w.startMinute) continue;
      const list = byDay.get(w.ymd) ?? [];
      list.push({ startMinute: w.startMinute, endMinute: w.endMinute });
      byDay.set(w.ymd, list);
    }
  }
  const out: BusyWindow[] = [];
  for (const ymd of [...byDay.keys()].sort()) {
    const list = byDay.get(ymd)!.sort((a, b) => a.startMinute - b.startMinute);
    let cur = { ...list[0] };
    for (const w of list.slice(1)) {
      if (w.startMinute <= cur.endMinute) {
        cur.endMinute = Math.max(cur.endMinute, w.endMinute);
      } else {
        out.push({ ymd, ...cur });
        cur = { ...w };
      }
    }
    out.push({ ymd, ...cur });
  }
  return out;
}

/**
 * Busy windows as the availability week view's own entries, which is how the
 * import modal previews them before anything is written.
 *
 * `startDate` is a LOCAL-midnight instant, the way the API's rows arrive:
 * `new Date("2026-10-05")` is UTC midnight, which in any negative offset reads
 * back as the 4th, so a bare day string would draw every block a day early.
 * `fromGoogle` draws them sky, the colour the page already uses for an import.
 */
export function busyWindowEntries(windows: BusyWindow[]): ApiUnavailability[] {
  return windows.map((w, i) => {
    const [y, m, d] = w.ymd.split("-").map(Number);
    return {
      id: `preview-${i}`,
      type: "SPECIFIC" as const,
      dayOfWeek: null,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      startDate: new Date(y, m - 1, d).toISOString(),
      endDate: null,
      requestId: null,
      note: null,
      fromGoogle: true,
    };
  });
}

/**
 * What /schedule says when it comes back from an import: the callback lands
 * on `?gcalImport=<blocks written>`, or `denied` / `error`. Null for anything
 * else (no param, or one we don't recognise).
 */
export function importNotice(
  status: string | null
): { tone: "indigo" | "amber" | "red"; text: string } | null {
  if (status === null) return null;
  if (status === "denied") {
    return { tone: "amber", text: "Google Calendar wasn't imported: access wasn't allowed." };
  }
  if (status === "error") {
    return { tone: "red", text: "Couldn't import from Google Calendar. Try again in a moment." };
  }
  if (!/^\d+$/.test(status)) return null;
  const n = Number(status);
  if (n === 0) {
    return {
      tone: "indigo",
      text: "Imported from Google Calendar: nothing on it in this window, so you're free throughout.",
    };
  }
  return {
    tone: "indigo",
    text: `Imported ${n} ${n === 1 ? "block" : "blocks"} from Google Calendar. Check them in the week view, adjust anything, then submit.`,
  };
}
