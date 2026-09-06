// Unit tests for recurrence expansion (lib/dates.ts).
import { describe, expect, it } from "vitest";
import {
  dateRangeLabel,
  durationBetween,
  minutesToShortTimeLabel,
  minutesToTimeInput,
  occurrencesInRange,
  shortDateTimeLabel,
  shortRangeLabel,
  startOfWeekMonday,
  upcomingOccurrences,
  zonedParts,
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

describe("shortDateTimeLabel", () => {
  it("renders a padded numeric date next to the time", () => {
    // A local Date, so the stamp doesn't move with the runner's timezone.
    expect(shortDateTimeLabel(new Date(2026, 5, 3, 20, 42))).toBe(
      "06/03/2026 8:42 PM"
    );
    expect(shortDateTimeLabel(new Date(2026, 11, 25, 9, 5))).toBe(
      "12/25/2026 9:05 AM"
    );
  });
});

describe("minutesToShortTimeLabel", () => {
  it("drops the :00 on the hour and the space before AM/PM", () => {
    expect(minutesToShortTimeLabel(7 * 60)).toBe("7AM");
    expect(minutesToShortTimeLabel(19 * 60)).toBe("7PM");
    expect(minutesToShortTimeLabel(19 * 60 + 30)).toBe("7:30PM");
  });

  it("renders both noon and midnight as 12", () => {
    expect(minutesToShortTimeLabel(0)).toBe("12AM");
    expect(minutesToShortTimeLabel(12 * 60)).toBe("12PM");
    expect(minutesToShortTimeLabel(12 * 60 + 5)).toBe("12:05PM");
  });
});

describe("minutesToTimeInput", () => {
  it("renders a zero-padded 24-hour time", () => {
    expect(minutesToTimeInput(0)).toBe("00:00");
    expect(minutesToTimeInput(9 * 60 + 5)).toBe("09:05");
    expect(minutesToTimeInput(19 * 60)).toBe("19:00");
  });

  it("wraps past midnight so a late end time still renders", () => {
    // 22:30 + 3h = 25:30 → 01:30 the next day.
    expect(minutesToTimeInput(25 * 60 + 30)).toBe("01:30");
    expect(minutesToTimeInput(1440)).toBe("00:00");
  });
});

describe("durationBetween", () => {
  it("measures a normal same-day set", () => {
    expect(durationBetween("09:00", "10:30")).toBe(90);
    expect(durationBetween("19:00", "20:00")).toBe(60);
  });

  it("reads an end before the start as running past midnight", () => {
    expect(durationBetween("22:00", "00:30")).toBe(150);
    expect(durationBetween("23:30", "01:00")).toBe(90);
  });

  it("refuses a zero-length set (the caller keeps its old duration)", () => {
    expect(durationBetween("09:00", "09:00")).toBeNull();
  });

  it("refuses an unparseable time", () => {
    expect(durationBetween("09:00", "")).toBeNull();
    expect(durationBetween("", "10:00")).toBeNull();
  });
});

describe("startOfWeekMonday", () => {
  const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()];

  it("returns the Monday of a midweek day's week", () => {
    // Thu Jul 16 2026 → Mon Jul 13.
    expect(ymd(startOfWeekMonday(new Date(2026, 6, 16)))).toEqual([2026, 6, 13]);
  });

  it("keeps a Monday where it is", () => {
    expect(ymd(startOfWeekMonday(new Date(2026, 6, 13)))).toEqual([2026, 6, 13]);
  });

  it("groups a Sunday with the week BEFORE it, not after", () => {
    // Sun Jul 19 2026 belongs to the week that started Mon Jul 13 — the whole
    // point of a Mon–Sun week (a Sun–Sat one would open a new week here).
    expect(ymd(startOfWeekMonday(new Date(2026, 6, 19)))).toEqual([2026, 6, 13]);
  });

  it("crosses a month boundary", () => {
    // Wed Jul 1 2026 → Mon Jun 29.
    expect(ymd(startOfWeekMonday(new Date(2026, 6, 1)))).toEqual([2026, 5, 29]);
  });

  it("drops the time component", () => {
    const d = startOfWeekMonday(new Date(2026, 6, 16, 19, 30));
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
  });
});

describe("zonedParts", () => {
  // Fri 18 Sep 2026, 7:00 PM in America/Los_Angeles.
  const instant = new Date("2026-09-19T02:00:00.000Z");

  it("reads an instant on a named zone's wall clock", () => {
    expect(zonedParts(instant, "America/Los_Angeles")).toEqual({
      year: 2026,
      month: 9,
      day: 18,
      ymd: 20260918,
      weekday: 5, // Friday
      minuteOfDay: 19 * 60,
    });
  });

  it("gives a different day and hour for the same instant elsewhere", () => {
    // The whole point: one instant, two clocks. UTC+8 calls this Saturday 10am.
    expect(zonedParts(instant, "Asia/Singapore")).toMatchObject({
      ymd: 20260919,
      weekday: 6, // Saturday
      minuteOfDay: 10 * 60,
    });
  });

  it("reports midnight as minute 0, not 24 hours in", () => {
    // hourCycle h23 — some implementations report midnight as hour 24.
    expect(
      zonedParts(new Date("2026-09-18T07:00:00.000Z"), "America/Los_Angeles")
    ).toMatchObject({ ymd: 20260918, minuteOfDay: 0 });
  });
});
