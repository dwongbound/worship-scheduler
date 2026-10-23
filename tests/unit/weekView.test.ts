import { describe, expect, it } from "vitest";
import {
  VIEW_END_MIN,
  VIEW_START_MIN,
  clipToView,
  compactTime,
  dayBlocks,
  shiftWeek,
  weekDays,
  weekStart,
} from "@/lib/weekView";
import type { ApiUnavailability } from "@/lib/types";

const base = {
  dayOfWeek: null,
  startMinute: null,
  endMinute: null,
  startDate: null,
  endDate: null,
  requestId: null,
  note: null,
};
const specific = (id: string, ymd: string, s: number, e: number, fromGoogle = false): ApiUnavailability => {
  const [y, m, d] = ymd.split("-").map(Number);
  return { ...base, id, type: "SPECIFIC", startDate: new Date(y, m - 1, d).toISOString(), startMinute: s, endMinute: e, fromGoogle };
};

describe("weeks", () => {
  it("starts a week on Sunday", () => {
    const start = weekStart(new Date(2026, 9, 21, 15, 30)); // Wed Oct 21
    expect(start).toEqual(new Date(2026, 9, 18));
    expect(weekDays(start).map((d) => d.getDate())).toEqual([18, 19, 20, 21, 22, 23, 24]);
  });
  it("steps a week at a time across a month boundary", () => {
    expect(shiftWeek(new Date(2026, 9, 25), 1)).toEqual(new Date(2026, 10, 1));
    expect(shiftWeek(new Date(2026, 9, 4), -1)).toEqual(new Date(2026, 8, 27));
  });
});

describe("dayBlocks", () => {
  const day = new Date(2026, 9, 5);
  it("tags each block with where it came from", () => {
    const recurring: ApiUnavailability = { ...base, id: "r", type: "RECURRING", dayOfWeek: 1, startMinute: 1140, endMinute: 1260 };
    const blocks = dayBlocks(
      [specific("g", "2026-10-05", 540, 600, true), specific("s", "2026-10-05", 720, 780), recurring],
      day
    );
    expect(blocks.map((b) => [b.id, b.kind])).toEqual([
      ["g", "google"],
      ["s", "specific"],
      ["r", "recurring"],
    ]);
    expect(blocks.every((b) => b.lanes === 1 && b.lane === 0)).toBe(true);
  });
  it("leaves out blocks on other days", () => {
    expect(dayBlocks([specific("x", "2026-10-06", 540, 600)], day)).toEqual([]);
  });
  it("puts overlapping blocks side by side, and frees the lane after", () => {
    const blocks = dayBlocks(
      [
        specific("a", "2026-10-05", 540, 660),
        specific("b", "2026-10-05", 600, 720),
        specific("c", "2026-10-05", 800, 860),
      ],
      day
    );
    const byId = Object.fromEntries(blocks.map((b) => [b.id, b]));
    expect([byId.a.lane, byId.a.lanes]).toEqual([0, 2]);
    expect([byId.b.lane, byId.b.lanes]).toEqual([1, 2]);
    expect([byId.c.lane, byId.c.lanes]).toEqual([0, 1]);
  });
  it("draws a legacy date range as the whole day", () => {
    const range: ApiUnavailability = {
      ...base,
      id: "d",
      type: "DATE_RANGE",
      startDate: new Date(2026, 9, 4).toISOString(),
      endDate: new Date(2026, 9, 6).toISOString(),
    };
    expect(dayBlocks([range], day)[0]).toMatchObject({ startMinute: 0, endMinute: 1440 });
  });
});

describe("clipToView", () => {
  const day = "2026-10-21";
  const on = (...es: ApiUnavailability[]) => clipToView(dayBlocks(es, new Date(2026, 9, 21)));
  it("shows 6 AM to 10 PM", () => {
    expect(VIEW_START_MIN).toBe(360);
    expect(VIEW_END_MIN).toBe(1320);
  });
  it("keeps a block inside the hours as it is", () => {
    const [b] = on(specific("a", day, 9 * 60, 11 * 60));
    expect([b.top, b.bottom]).toEqual([540, 660]);
  });
  it("trims a block that runs past either end, keeping its real times", () => {
    const [b] = on(specific("a", day, 4 * 60, 23 * 60));
    expect([b.top, b.bottom]).toEqual([360, 1320]);
    expect([b.startMinute, b.endMinute]).toEqual([240, 1380]);
  });
  it("draws an all-day block across the whole view", () => {
    const [b] = on(specific("a", day, 0, 1440));
    expect([b.top, b.bottom]).toEqual([360, 1320]);
  });
  it("drops blocks wholly before 6 AM or after 10 PM, edges included", () => {
    expect(on(specific("a", day, 60, 180), specific("b", day, 22 * 60, 23 * 60), specific("c", day, 300, 360))).toEqual([]);
  });
  it("keeps the lanes dayBlocks gave overlapping blocks", () => {
    const out = on(specific("a", day, 300, 480), specific("b", day, 330, 420));
    expect(out.map((b) => [b.id, b.lane, b.lanes, b.top])).toEqual([
      ["a", 0, 2, 360],
      ["b", 1, 2, 360],
    ]);
  });
});

describe("compactTime", () => {
  it("writes hours the short way", () => {
    expect(compactTime(0)).toBe("12a");
    expect(compactTime(570)).toBe("9:30a");
    expect(compactTime(720)).toBe("12p");
    expect(compactTime(1020)).toBe("5p");
  });
});
