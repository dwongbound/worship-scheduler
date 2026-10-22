// Pure layout for the availability WEEK view (components/AvailabilityWeekView):
// a week of days left to right, the hours of the day top to bottom, and each
// block drawn as a box spanning its time. It's the view for checking an
// "Import from Google Calendar" landed where it should, so each block keeps
// where it came from. Unit-tested in tests/unit/weekView.test.ts.
import { FULL_DAY_MIN } from "./availability";
import type { ApiUnavailability } from "./types";

/** Where a block came from — each draws in its own colour. */
export type BlockKind = "google" | "specific" | "recurring";

export interface WeekBlock {
  id: string;
  kind: BlockKind;
  startMinute: number;
  endMinute: number;
  // Side-by-side placement when blocks overlap: this one sits in column
  // `lane` of `lanes` across the day.
  lane: number;
  lanes: number;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The Sunday that starts `d`'s week, at local midnight. */
export function weekStart(d: Date): Date {
  const day = startOfDay(d);
  day.setDate(day.getDate() - day.getDay());
  return day;
}

/** The seven days of the week starting `start`. */
export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

/** Shift a week start by `weeks` (negative = back). */
export function shiftWeek(start: Date, weeks: number): Date {
  const d = new Date(start);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

// Same matching as the month calendar: RECURRING by weekday inside its optional
// [startDate, endDate] span; SPECIFIC / DATE_RANGE when the day falls within
// [startDate, endDate] (endDate defaulting to startDate).
function appliesOn(rule: ApiUnavailability, day: Date): boolean {
  if (rule.type === "RECURRING") {
    if (day.getDay() !== rule.dayOfWeek) return false;
    if (rule.startDate && day < startOfDay(new Date(rule.startDate))) return false;
    return !rule.endDate || day <= startOfDay(new Date(rule.endDate));
  }
  if (!rule.startDate) return false;
  const start = startOfDay(new Date(rule.startDate));
  const end = rule.endDate ? startOfDay(new Date(rule.endDate)) : start;
  return day >= start && day <= end;
}

function kindOf(rule: ApiUnavailability): BlockKind {
  if (rule.fromGoogle) return "google";
  return rule.type === "RECURRING" ? "recurring" : "specific";
}

/**
 * The blocks on one day, positioned. A block with no window (a legacy
 * DATE_RANGE) covers the whole day. Overlapping blocks are spread into lanes
 * so neither hides the other: each cluster of mutually-overlapping blocks
 * shares one lane count, and a block takes the first lane free at its start.
 */
export function dayBlocks(entries: ApiUnavailability[], day: Date): WeekBlock[] {
  const d = startOfDay(day);
  const raw = entries
    .filter((e) => appliesOn(e, d))
    .map((e) => ({
      id: e.id,
      kind: kindOf(e),
      startMinute: e.type === "DATE_RANGE" ? 0 : (e.startMinute ?? 0),
      endMinute: e.type === "DATE_RANGE" ? FULL_DAY_MIN : (e.endMinute ?? FULL_DAY_MIN),
    }))
    .filter((b) => b.endMinute > b.startMinute)
    .sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);

  const out: WeekBlock[] = [];
  let cluster: WeekBlock[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const close = () => {
    const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
    for (const b of cluster) out.push({ ...b, lanes });
    cluster = [];
    laneEnds.length = 0;
  };
  for (const b of raw) {
    if (b.startMinute >= clusterEnd && cluster.length) close();
    let lane = laneEnds.findIndex((end) => end <= b.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.endMinute;
    cluster.push({ ...b, lane, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, b.endMinute);
  }
  if (cluster.length) close();
  return out;
}

/** "6a", "9:30a", "12p" — the month calendar's compact time. */
export function compactTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 || h === 24 ? "a" : "p";
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`;
}
