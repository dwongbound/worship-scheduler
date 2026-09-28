// Unit tests for lib/calendarScroll — the geometry behind DateSelect's
// stepping calendar: the five week rows it shows, where that window opens,
// which month the heading therefore names, and the rate limit that keeps a
// trackpad flick from flying through a year.
//
// Dates are built with the local-midnight constructor (not ISO strings)
// because that's how the component builds them; the helpers are all local-time.
import { describe, expect, it } from "vitest";
import {
  CALENDAR_VISIBLE_WEEKS,
  STEP_COOLDOWN_MS,
  VISIBLE_WEEKS,
  addWeeks,
  buildWeeks,
  canStep,
  centredWeek,
  majorityMonth,
  monthKey,
  openingWeek,
  startOfMonth,
  startOfWeek,
  weekDays,
  weeksBetween,
} from "@/lib/calendarScroll";

// 2026-09-27 is a Sunday; 2026-09-30 is the Wednesday that ends September.
const SUN_SEP_27 = new Date(2026, 8, 27);
const WED_SEP_30 = new Date(2026, 8, 30);

describe("startOfWeek", () => {
  it("walks back to Sunday", () => {
    expect(startOfWeek(WED_SEP_30)).toEqual(SUN_SEP_27);
  });

  it("leaves a Sunday where it is", () => {
    expect(startOfWeek(SUN_SEP_27)).toEqual(SUN_SEP_27);
  });

  it("crosses a month boundary backwards", () => {
    // Thu 2026-10-01 belongs to the week that started Sun 2026-09-27.
    expect(startOfWeek(new Date(2026, 9, 1))).toEqual(SUN_SEP_27);
  });

  it("drops the time of day", () => {
    expect(startOfWeek(new Date(2026, 8, 30, 23, 45))).toEqual(SUN_SEP_27);
  });
});

describe("addWeeks / weeksBetween", () => {
  it("steps forward and back a week at a time", () => {
    expect(addWeeks(SUN_SEP_27, 1)).toEqual(new Date(2026, 9, 4));
    expect(addWeeks(SUN_SEP_27, -1)).toEqual(new Date(2026, 8, 20));
  });

  it("round-trips through weeksBetween", () => {
    for (const n of [-9, -1, 0, 1, 5, 40]) {
      expect(weeksBetween(SUN_SEP_27, addWeeks(SUN_SEP_27, n))).toBe(n);
    }
  });

  it("measures whole weeks between days mid-week", () => {
    // Wed Sep 30 and Thu Oct 1 are the same row, so zero weeks apart.
    expect(weeksBetween(WED_SEP_30, new Date(2026, 9, 1))).toBe(0);
    expect(weeksBetween(WED_SEP_30, new Date(2026, 9, 8))).toBe(1);
  });

  it("survives a daylight-saving change", () => {
    // US DST ends 2026-11-01; a week either side must still be exactly a week.
    const before = new Date(2026, 9, 25);
    expect(weeksBetween(before, addWeeks(before, 2))).toBe(2);
  });
});

describe("buildWeeks", () => {
  it("returns `count` rows, a week apart, snapped to the week's Sunday", () => {
    expect(buildWeeks(WED_SEP_30, 3)).toEqual([
      SUN_SEP_27,
      new Date(2026, 9, 4),
      new Date(2026, 9, 11),
    ]);
  });

  it("returns nothing for a non-positive count", () => {
    expect(buildWeeks(SUN_SEP_27, 0)).toEqual([]);
    expect(buildWeeks(SUN_SEP_27, -5)).toEqual([]);
  });

  it("crosses a year boundary", () => {
    expect(buildWeeks(new Date(2026, 11, 27), 2)[1]).toEqual(
      new Date(2027, 0, 3)
    );
  });
});

describe("weekDays", () => {
  it("is seven consecutive days from the Sunday", () => {
    const days = weekDays(SUN_SEP_27);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual(SUN_SEP_27);
    expect(days[6]).toEqual(new Date(2026, 9, 3));
  });

  it("runs straight through the end of a month — no gap, no padding", () => {
    // The point of the continuous grid: Sep 30 is followed by Oct 1 in the
    // same row, with nothing between them.
    expect(weekDays(SUN_SEP_27).map((d) => d.getDate())).toEqual([
      27, 28, 29, 30, 1, 2, 3,
    ]);
  });
});

describe("openingWeek", () => {
  it("opens on the week the month starts in", () => {
    // September 2026 starts on Tue the 1st, in the week beginning Aug 30.
    expect(openingWeek(new Date(2026, 8, 15))).toEqual(new Date(2026, 7, 30));
  });

  it("keeps the whole month's first five rows in view", () => {
    const weeks = buildWeeks(openingWeek(new Date(2026, 8, 1)), VISIBLE_WEEKS);
    expect(weeks).toHaveLength(VISIBLE_WEEKS);
    expect(monthKey(majorityMonth(weeks)!)).toBe("2026-09");
  });

  it("slides down so a late day in a long month is still on screen", () => {
    // August 2026 starts on Saturday, so it spans six rows: the 31st sits on
    // row 5, past the five-row window measured from the month's first week.
    const late = new Date(2026, 7, 31);
    const weeks = buildWeeks(openingWeek(late), VISIBLE_WEEKS);
    const shown = weeks.flatMap(weekDays).map((d) => d.getTime());
    expect(shown).toContain(startOfWeek(late).getTime());
    // It lands on the last row, not off the bottom.
    expect(weeksBetween(openingWeek(late), late)).toBe(VISIBLE_WEEKS - 1);
  });

  it("is stable — opening on any day of a short month gives one window", () => {
    const first = openingWeek(new Date(2026, 8, 1));
    for (const day of [3, 10, 20, 28]) {
      expect(openingWeek(new Date(2026, 8, day))).toEqual(first);
    }
  });
});

describe("centredWeek", () => {
  it("puts the day's week in the middle row", () => {
    const day = new Date(2026, 8, 28); // Mon, week of Sep 27
    const weeks = buildWeeks(centredWeek(day), VISIBLE_WEEKS);
    expect(weeks[Math.floor(VISIBLE_WEEKS / 2)]).toEqual(startOfWeek(day));
  });

  it("always moves the window when the day is at an edge of it", () => {
    // The Today button's real job. Sep 28 2026 sits on the LAST row of the
    // window you get from openingWeek — so jumping to it has to move, or the
    // click looks like it did nothing.
    const day = new Date(2026, 8, 28);
    expect(weeksBetween(openingWeek(day), day)).toBe(VISIBLE_WEEKS - 1);
    expect(centredWeek(day)).not.toEqual(openingWeek(day));
  });

  it("shows the day whatever weekday it falls on", () => {
    for (const date of [1, 15, 28, 30]) {
      const day = new Date(2026, 8, date);
      const shown = buildWeeks(centredWeek(day), VISIBLE_WEEKS)
        .flatMap(weekDays)
        .map((d) => d.getTime());
      expect(shown).toContain(day.getTime());
    }
  });
});

describe("majorityMonth", () => {
  it("names the month when every visible day is in it", () => {
    // Sep 6 → Sep 26 is three whole weeks of September.
    expect(monthKey(majorityMonth(buildWeeks(new Date(2026, 8, 6), 3))!)).toBe(
      "2026-09"
    );
  });

  it("keeps the earlier month while it still owns most of the view", () => {
    // Aug 30 → Sep 5 alone: 2 August days against 5 September ones.
    expect(monthKey(majorityMonth(buildWeeks(new Date(2026, 7, 30), 1))!)).toBe(
      "2026-09"
    );
  });

  it("flips only once the next month is in the majority", () => {
    // Sep 27 → Oct 3 on its own is 4 September days, 3 October: still September.
    expect(monthKey(majorityMonth(buildWeeks(SUN_SEP_27, 1))!)).toBe("2026-09");
    // Add the next row (all October) and October takes it, 10 to 4.
    expect(monthKey(majorityMonth(buildWeeks(SUN_SEP_27, 2))!)).toBe("2026-10");
  });

  it("breaks an exact tie in favour of the earlier month", () => {
    // Oct 25–31 and Nov 1–7 are whole weeks inside their own months: a clean
    // 7 against 7. The heading must not flip on a 50/50 split.
    expect(monthKey(majorityMonth(buildWeeks(new Date(2026, 9, 25), 2))!)).toBe(
      "2026-10"
    );
  });

  it("names the right month for a full five-row window", () => {
    // The real case: five rows from Aug 30 is 2 Aug + 30 Sep + 3 Oct.
    const weeks = buildWeeks(new Date(2026, 7, 30), VISIBLE_WEEKS);
    expect(monthKey(majorityMonth(weeks)!)).toBe("2026-09");
  });

  it("returns null with no weeks", () => {
    expect(majorityMonth([])).toBeNull();
  });
});

describe("canStep", () => {
  it("allows the first step", () => {
    expect(canStep(1000, 0)).toBe(true);
  });

  it("refuses a second step inside the cooldown", () => {
    expect(canStep(1000 + STEP_COOLDOWN_MS - 1, 1000)).toBe(false);
  });

  it("allows one exactly on the boundary and after", () => {
    expect(canStep(1000 + STEP_COOLDOWN_MS, 1000)).toBe(true);
    expect(canStep(1000 + STEP_COOLDOWN_MS * 3, 1000)).toBe(true);
  });

  it("throttles a burst of trackpad events down to one step", () => {
    // 20 wheel events over 100ms — what one flick actually produces. `last`
    // starts at 0 (never stepped), as the component's ref does.
    const fire = (fromMs: number, toMs: number) => {
      let last = 0;
      let steps = 0;
      for (let t = fromMs; t < toMs; t += 5) {
        if (canStep(t, last)) {
          last = t;
          steps++;
        }
      }
      return steps;
    };
    expect(fire(1000, 1100)).toBe(1);
    // Half a second of momentum still only advances a few weeks, not dozens.
    expect(fire(1000, 1500)).toBeLessThanOrEqual(4);
  });
});

describe("the window itself", () => {
  it("is always exactly five rows", () => {
    for (const on of [
      new Date(2026, 0, 1),
      new Date(2026, 7, 31),
      new Date(2026, 11, 31),
    ]) {
      expect(buildWeeks(openingWeek(on), VISIBLE_WEEKS)).toHaveLength(5);
    }
  });

  it("moves by exactly one week per step, in either direction", () => {
    const from = openingWeek(new Date(2026, 8, 15));
    expect(weeksBetween(from, addWeeks(from, 1))).toBe(1);
    expect(weeksBetween(from, addWeeks(from, -1))).toBe(-1);
    // …and the rows it shows shift by exactly seven days.
    const before = buildWeeks(from, VISIBLE_WEEKS);
    const after = buildWeeks(addWeeks(from, 1), VISIBLE_WEEKS);
    expect(after[0]).toEqual(before[1]);
    expect(weeksBetween(before[4], after[4])).toBe(1);
  });

  it("has no bound on where it can travel", () => {
    // Nothing clamps the window: a picker whose min and max sit in one month
    // must still be able to move (that clamp was what once froze it solid).
    const far = addWeeks(openingWeek(new Date(2026, 8, 1)), 400);
    expect(buildWeeks(far, VISIBLE_WEEKS)).toHaveLength(5);
    expect(far.getFullYear()).toBeGreaterThan(2033);
  });
});

describe("CALENDAR_VISIBLE_WEEKS", () => {
  it("is tall enough for any month, which the picker's window is not", () => {
    // A month spans six week rows whenever it is long enough to start late in
    // one — 31 days beginning on a Saturday is the worst case. The calendar
    // tab has to show a whole month, so its window has to clear that.
    const worstCase = new Date(2026, 7, 1); // 1 Aug 2026 — a Saturday, 31 days
    expect(worstCase.getDay()).toBe(6);
    const rows = weeksBetween(
      startOfWeek(worstCase),
      new Date(2026, 7, 31)
    ) + 1;
    expect(rows).toBe(6);
    expect(CALENDAR_VISIBLE_WEEKS).toBeGreaterThanOrEqual(rows);
    expect(VISIBLE_WEEKS).toBeLessThan(rows);
  });
});
