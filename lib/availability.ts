// Pure availability-block logic, shared by the /schedule page's date-picker
// dots and its submit-confirmation modal. Kept out of the page component so it
// can be unit-tested (tests/unit/availability.test.ts).
import { toYmd } from "@/lib/dates";
import type { ApiUnavailability } from "@/lib/types";

// A day with no time window on it is "all day" — 24h in minutes-from-midnight.
export const FULL_DAY_MIN = 24 * 60;

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
      // Recurring blocks apply to every date on their weekday.
      if (date.getDay() !== e.dayOfWeek) continue;
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
