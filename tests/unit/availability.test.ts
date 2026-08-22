// Unit tests for the availability block-level logic (lib/availability.ts) that
// drives the /schedule date-picker dots and the submit-confirmation summary.
import { describe, expect, it } from "vitest";
import {
  FULL_DAY_MIN,
  applyDayEdit,
  blockedDaysInRange,
  dayBlockLevel,
  dayIsRepeating,
  expandRecurringBlocks,
  mergeWindows,
  weeksFromToday,
} from "@/lib/availability";
import type { ApiUnavailability } from "@/lib/types";

// The API stores a block's startDate as local midnight and serialises it to a
// UTC ISO string; dayBlockLevel parses it back in the same (local) zone. Build
// test dates the same way so the round-trip matches production regardless of
// the machine's timezone.
const isoDay = (y: number, m: number, d: number) =>
  new Date(y, m - 1, d).toISOString();

let seq = 0;
function specific(
  startDate: string,
  opts: { endDate?: string; startMinute?: number; endMinute?: number } = {}
): ApiUnavailability {
  return {
    id: `s${seq++}`,
    type: "SPECIFIC",
    dayOfWeek: null,
    startMinute: opts.startMinute ?? null,
    endMinute: opts.endMinute ?? null,
    startDate,
    endDate: opts.endDate ?? null,
    requestId: null,
    note: null,
  };
}
function recurring(
  dayOfWeek: number,
  opts: { startMinute?: number; endMinute?: number; endDate?: string } = {}
): ApiUnavailability {
  return {
    id: `r${seq++}`,
    type: "RECURRING",
    dayOfWeek,
    startMinute: opts.startMinute ?? null,
    endMinute: opts.endMinute ?? null,
    startDate: null,
    endDate: opts.endDate ?? null,
    requestId: null,
    note: null,
  };
}
function dateRange(startDate: string, endDate: string): ApiUnavailability {
  return {
    id: `d${seq++}`,
    type: "DATE_RANGE",
    dayOfWeek: null,
    startMinute: null,
    endMinute: null,
    startDate,
    endDate,
    requestId: null,
    note: null,
  };
}

// A fixed reference day: Wed, July 8 2026.
const JUL8 = "2026-07-08";
const jul8Weekday = new Date(2026, 6, 8).getDay(); // 3 (Wed)

describe("dayBlockLevel", () => {
  it("returns null for a free day", () => {
    expect(dayBlockLevel([], JUL8)).toBeNull();
    expect(dayBlockLevel([specific(isoDay(2026, 7, 9))], JUL8)).toBeNull();
  });

  it("marks an all-day SPECIFIC block full on its day only", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), { startMinute: 0, endMinute: FULL_DAY_MIN }),
    ];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-07")).toBeNull();
    expect(dayBlockLevel(entries, "2026-07-09")).toBeNull();
  });

  it("treats a SPECIFIC block with no time window as all-day (full)", () => {
    // block-days rows can carry null minutes; those mean the whole day.
    const entries = [specific(isoDay(2026, 7, 8))];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
  });

  it("marks a timed SPECIFIC block partial", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), { startMinute: 9 * 60, endMinute: 12 * 60 }),
    ];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("partial");
  });

  it("covers every day of a SPECIFIC range, inclusive", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), {
        endDate: isoDay(2026, 7, 10),
        startMinute: 0,
        endMinute: FULL_DAY_MIN,
      }),
    ];
    expect(dayBlockLevel(entries, "2026-07-07")).toBeNull();
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-09")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-10")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-11")).toBeNull();
  });

  it("applies a RECURRING block to every matching weekday, all-day when untimed", () => {
    const entries = [recurring(jul8Weekday)];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full"); // Wed
    expect(dayBlockLevel(entries, "2026-07-15")).toBe("full"); // next Wed
    expect(dayBlockLevel(entries, "2026-07-09")).toBeNull(); // Thu
  });

  it("marks a timed RECURRING block partial", () => {
    const entries = [
      recurring(jul8Weekday, { startMinute: 9 * 60, endMinute: 12 * 60 }),
    ];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("partial");
  });

  it("treats a legacy DATE_RANGE (no minutes) as full across its span", () => {
    const entries = [dateRange(isoDay(2026, 7, 8), isoDay(2026, 7, 9))];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-09")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-10")).toBeNull();
  });

  it("lets a full block win over a partial one on the same day", () => {
    const entries = [
      recurring(jul8Weekday, { startMinute: 9 * 60, endMinute: 12 * 60 }), // partial
      specific(isoDay(2026, 7, 8), { startMinute: 0, endMinute: FULL_DAY_MIN }), // full
    ];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
  });

  it("ignores a SPECIFIC entry with no startDate", () => {
    const orphan = specific(isoDay(2026, 7, 8));
    orphan.startDate = null;
    expect(dayBlockLevel([orphan], "2026-07-08")).toBeNull();
  });
});

describe("dayIsRepeating", () => {
  it("is true only on the weekday a RECURRING rule covers", () => {
    const entries = [recurring(jul8Weekday)];
    expect(dayIsRepeating(entries, "2026-07-08")).toBe(true); // Wed
    expect(dayIsRepeating(entries, "2026-07-15")).toBe(true); // next Wed
    expect(dayIsRepeating(entries, "2026-07-09")).toBe(false); // Thu
  });

  it("stops at the rule's endDate — the last day it repeats", () => {
    const entries = [recurring(jul8Weekday, { endDate: isoDay(2026, 7, 15) })];
    expect(dayIsRepeating(entries, "2026-07-15")).toBe(true); // inclusive
    expect(dayIsRepeating(entries, "2026-07-22")).toBe(false);
  });

  it("ignores dated blocks — only a weekly repeat counts", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), { startMinute: 0, endMinute: FULL_DAY_MIN }),
      dateRange(isoDay(2026, 7, 8), isoDay(2026, 7, 9)),
    ];
    expect(dayIsRepeating(entries, "2026-07-08")).toBe(false);
  });
});

describe("blockedDaysInRange", () => {
  it("lists only blocked days, in ascending order, with a level and label", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), { startMinute: 0, endMinute: FULL_DAY_MIN }),
      specific(isoDay(2026, 7, 10), {
        startMinute: 9 * 60,
        endMinute: 12 * 60,
      }),
    ];
    const days = blockedDaysInRange(
      entries,
      isoDay(2026, 7, 6),
      isoDay(2026, 7, 12)
    );
    expect(days.map((d) => d.ymd)).toEqual(["2026-07-08", "2026-07-10"]);
    expect(days.map((d) => d.level)).toEqual(["full", "partial"]);
    // Labels are human-readable and name the weekday.
    expect(days[0].label).toMatch(/Jul 8/);
    expect(days[0].label).toMatch(/Wed/);
  });

  it("includes both window endpoints (inclusive)", () => {
    const entries = [
      specific(isoDay(2026, 7, 6)),
      specific(isoDay(2026, 7, 12)),
    ];
    const days = blockedDaysInRange(
      entries,
      isoDay(2026, 7, 6),
      isoDay(2026, 7, 12)
    );
    expect(days.map((d) => d.ymd)).toEqual(["2026-07-06", "2026-07-12"]);
  });

  it("returns nothing when the window is entirely free", () => {
    const entries = [specific(isoDay(2026, 7, 20))];
    expect(
      blockedDaysInRange(entries, isoDay(2026, 7, 6), isoDay(2026, 7, 12))
    ).toEqual([]);
  });

  it("expands a recurring block to each matching weekday in the window", () => {
    const days = blockedDaysInRange(
      [recurring(jul8Weekday)],
      isoDay(2026, 7, 6),
      isoDay(2026, 7, 20)
    );
    // Wednesdays in [Jul 6, Jul 20]: the 8th and the 15th.
    expect(days.map((d) => d.ymd)).toEqual(["2026-07-08", "2026-07-15"]);
    expect(days.every((d) => d.level === "full")).toBe(true);
  });
});

// applyDayEdit is the client-side mirror of /api/availability/block-days, so its
// result is described the same way the calendar reads it: dayBlockLevel per day.
describe("applyDayEdit", () => {
  it("blocks a run of previously-free days", () => {
    const next = applyDayEdit([], "2026-07-08", "2026-07-10", true);
    expect(dayBlockLevel(next, "2026-07-07")).toBeNull();
    expect(dayBlockLevel(next, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(next, "2026-07-09")).toBe("full");
    expect(dayBlockLevel(next, "2026-07-10")).toBe("full");
    expect(dayBlockLevel(next, "2026-07-11")).toBeNull();
  });

  it("merges a new day into an adjacent standalone block into one range", () => {
    const entries = [specific(isoDay(2026, 7, 8))]; // all-day (null minutes)
    const next = applyDayEdit(entries, "2026-07-09", "2026-07-09", true);
    // One contiguous block now covers the 8th and 9th.
    const allDay = next.filter((e) => e.type === "SPECIFIC");
    expect(allDay).toHaveLength(1);
    expect(dayBlockLevel(next, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(next, "2026-07-09")).toBe("full");
  });

  it("does not double-block a day already covered", () => {
    const entries = [specific(isoDay(2026, 7, 8))];
    const next = applyDayEdit(entries, "2026-07-08", "2026-07-08", true);
    // Nothing to add — returns the original array untouched.
    expect(next).toBe(entries);
  });

  it("splits a covering range when a middle day is unblocked", () => {
    const entries = [
      specific(isoDay(2026, 7, 8), {
        endDate: isoDay(2026, 7, 10),
        startMinute: 0,
        endMinute: FULL_DAY_MIN,
      }),
    ];
    const next = applyDayEdit(entries, "2026-07-09", "2026-07-09", false);
    expect(dayBlockLevel(next, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(next, "2026-07-09")).toBeNull(); // cleared
    expect(dayBlockLevel(next, "2026-07-10")).toBe("full");
  });

  it("preserves a block's requestId when splitting it", () => {
    const tied = specific(isoDay(2026, 7, 8), {
      endDate: isoDay(2026, 7, 10),
      startMinute: 0,
      endMinute: FULL_DAY_MIN,
    });
    tied.requestId = "req1";
    const next = applyDayEdit([tied], "2026-07-09", "2026-07-09", false);
    expect(next.every((e) => e.requestId === "req1")).toBe(true);
  });

  it("clears timed blocks too, but leaves weekly rules alone", () => {
    const entries = [
      recurring(jul8Weekday), // all-day recurring
      specific(isoDay(2026, 7, 8), { startMinute: 9 * 60, endMinute: 12 * 60 }),
    ];
    const next = applyDayEdit(entries, "2026-07-08", "2026-07-08", false);
    // Clearing a day means "I'm free all of it", so the timed block goes.
    expect(next).not.toContain(entries[1]);
    // A weekly rule has no per-date exception in the schema, so it survives —
    // and keeps the day blocked. The UI says so rather than leaving it a
    // mystery (see the block-days route's recurringDays count).
    expect(next).toContain(entries[0]);
    expect(dayBlockLevel(next, "2026-07-08")).toBe("full");
  });

  it("clearing a partly-overlapped timed block keeps its window on the rest", () => {
    // A 9am–12pm block across Jul 8–10; clear only the 9th.
    const entries = [
      specific(isoDay(2026, 7, 8), {
        endDate: isoDay(2026, 7, 10),
        startMinute: 9 * 60,
        endMinute: 12 * 60,
      }),
    ];
    const next = applyDayEdit(entries, "2026-07-09", "2026-07-09", false);
    expect(dayBlockLevel(next, "2026-07-09")).toBeNull();
    // The 8th and 10th survive as morning blocks, not flattened to all-day.
    expect(dayBlockLevel(next, "2026-07-08")).toBe("partial");
    expect(dayBlockLevel(next, "2026-07-10")).toBe("partial");
    expect(next.every((e) => e.startMinute === 9 * 60 && e.endMinute === 12 * 60)).toBe(
      true
    );
  });
});

describe("mergeWindows", () => {
  it("merges touching windows", () => {
    // Morning (6–12) + afternoon (12–17) is one 6am–5pm window.
    expect(
      mergeWindows([
        { startMinute: 720, endMinute: 1020 },
        { startMinute: 360, endMinute: 720 },
      ])
    ).toEqual([{ startMinute: 360, endMinute: 1020 }]);
  });

  it("keeps a gap between windows", () => {
    const windows = [
      { startMinute: 360, endMinute: 720 },
      { startMinute: 1020, endMinute: 1320 },
    ];
    expect(mergeWindows(windows)).toEqual(windows);
  });

  it("swallows narrower windows inside an all-day one", () => {
    expect(
      mergeWindows([
        { startMinute: 360, endMinute: 720 },
        { startMinute: 0, endMinute: FULL_DAY_MIN },
      ])
    ).toEqual([{ startMinute: 0, endMinute: FULL_DAY_MIN }]);
  });
});

describe("expandRecurringBlocks", () => {
  it("crosses every day with every merged window, day then time", () => {
    // Mon–Wed, mornings + afternoons → three blocks, one merged window each.
    const blocks = expandRecurringBlocks(
      [3, 1, 2],
      [
        { startMinute: 360, endMinute: 720 },
        { startMinute: 720, endMinute: 1020 },
      ]
    );
    expect(blocks).toEqual([
      { dayOfWeek: 1, startMinute: 360, endMinute: 1020, endDate: null },
      { dayOfWeek: 2, startMinute: 360, endMinute: 1020, endDate: null },
      { dayOfWeek: 3, startMinute: 360, endMinute: 1020, endDate: null },
    ]);
  });

  it("keeps separate windows on each day", () => {
    const blocks = expandRecurringBlocks(
      [1, 5],
      [
        { startMinute: 360, endMinute: 720 },
        { startMinute: 1020, endMinute: 1320 },
      ]
    );
    expect(blocks).toHaveLength(4);
    expect(blocks.map((b) => b.dayOfWeek)).toEqual([1, 1, 5, 5]);
  });

  it("stamps the stop date on every block", () => {
    const blocks = expandRecurringBlocks(
      [1, 2],
      [{ startMinute: 0, endMinute: 1440 }],
      "2026-09-30"
    );
    expect(blocks.every((b) => b.endDate === "2026-09-30")).toBe(true);
  });

  it("returns nothing when either axis is empty", () => {
    expect(expandRecurringBlocks([], [{ startMinute: 0, endMinute: 60 }])).toEqual([]);
    expect(expandRecurringBlocks([1], [])).toEqual([]);
  });
});

describe("recurring blocks that stop repeating", () => {
  // 2026-07-08 is a Wednesday; 2026-07-15 and 07-22 are the next two.
  const WED = 3;

  it("applies up to and including its last day", () => {
    const entries = [recurring(WED, { endDate: isoDay(2026, 7, 15) })];
    expect(dayBlockLevel(entries, "2026-07-08")).toBe("full");
    expect(dayBlockLevel(entries, "2026-07-15")).toBe("full"); // inclusive
    expect(dayBlockLevel(entries, "2026-07-22")).toBeNull(); // expired
  });

  it("repeats forever without an end date", () => {
    const entries = [recurring(WED)];
    expect(dayBlockLevel(entries, "2027-07-21")).toBe("full");
  });
});

describe("weeksFromToday", () => {
  it("counts whole weeks from the given day", () => {
    expect(weeksFromToday(4, new Date(2026, 6, 8))).toBe("2026-08-05");
    expect(weeksFromToday(1, new Date(2026, 6, 8))).toBe("2026-07-15");
  });

  it("crosses a year boundary", () => {
    expect(weeksFromToday(2, new Date(2026, 11, 28))).toBe("2027-01-11");
  });
});
