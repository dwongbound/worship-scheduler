// Unit tests for recurrence expansion (lib/dates.ts).
import { describe, expect, it } from "vitest";
import {
  dateRangeLabel,
  occurrencesInRange,
  shortRangeLabel,
  upcomingOccurrences,
} from "@/lib/dates";

describe("range labels collapse single days", () => {
  // Local Date objects (not "YYYY-MM-DD" strings, which parse as UTC midnight).
  const jul16 = new Date(2026, 6, 16);
  const jul18 = new Date(2026, 6, 18);

  it("shortRangeLabel shows one date when start === end", () => {
    expect(shortRangeLabel(jul16, jul16)).toBe("7/16/26");
  });

  it("shortRangeLabel shows both dates for a real range", () => {
    expect(shortRangeLabel(jul16, jul18)).toBe("7/16/26 - 7/18/26");
  });

  it("dateRangeLabel collapses to a single verbose day", () => {
    expect(dateRangeLabel(jul16, jul16)).not.toContain("→");
    expect(dateRangeLabel(jul16, jul18)).toContain("→");
  });
});

describe("upcomingOccurrences", () => {
  // Thursday Jan 1 2026, 10:00 local time.
  const FROM = new Date(2026, 0, 1, 10, 0);

  it("returns the requested number of weeks", () => {
    // Mondays at 19:00 for 4 weeks.
    const dates = upcomingOccurrences(1, 19 * 60, 4, FROM);
    expect(dates).toHaveLength(4);
  });

  it("lands on the right weekday and time", () => {
    const dates = upcomingOccurrences(1, 19 * 60, 2, FROM);
    for (const d of dates) {
      expect(d.getDay()).toBe(1); // Monday
      expect(d.getHours()).toBe(19);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it("spaces occurrences exactly 7 days apart", () => {
    const dates = upcomingOccurrences(1, 19 * 60, 3, FROM);
    expect(dates[1].getTime() - dates[0].getTime()).toBe(7 * 24 * 3600 * 1000);
    expect(dates[2].getTime() - dates[1].getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("skips an occurrence earlier the same day", () => {
    // From is Thursday 10:00; a Thursday 09:00 recurrence already passed
    // today, so the first hit is NEXT Thursday.
    const dates = upcomingOccurrences(4, 9 * 60, 2, FROM);
    expect(dates[0].getDate()).toBe(8); // Jan 8, not Jan 1
  });

  it("includes an occurrence later the same day", () => {
    const dates = upcomingOccurrences(4, 20 * 60, 2, FROM);
    expect(dates[0].getDate()).toBe(1); // today at 20:00 still counts
  });

  it("handles minute offsets (7:30pm = 1170 minutes)", () => {
    const dates = upcomingOccurrences(1, 1170, 1, FROM);
    expect(dates[0].getHours()).toBe(19);
    expect(dates[0].getMinutes()).toBe(30);
  });
});

describe("occurrencesInRange", () => {
  it("returns every matching weekday within [from, to] inclusive", () => {
    // Mondays at 19:00 from Jan 1 (Thu) through Jan 26 (Mon).
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 26, 23, 59);
    const dates = occurrencesInRange(1, 19 * 60, from, to);
    // Jan 5, 12, 19, 26.
    expect(dates.map((d) => d.getDate())).toEqual([5, 12, 19, 26]);
    for (const d of dates) expect(d.getDay()).toBe(1);
  });

  it("excludes occurrences before `from`", () => {
    // Start mid-week: the Monday Jan 5 is the first hit after Jan 2.
    const from = new Date(2026, 0, 2, 12, 0);
    const to = new Date(2026, 0, 20);
    const dates = occurrencesInRange(1, 9 * 60, from, to);
    expect(dates[0].getDate()).toBe(5);
  });

  it("returns nothing when no matching day falls in the window", () => {
    const from = new Date(2026, 0, 6); // Tue
    const to = new Date(2026, 0, 8); // Thu — no Sunday between
    expect(occurrencesInRange(0, 9 * 60, from, to)).toHaveLength(0);
  });
});
