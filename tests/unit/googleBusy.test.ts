import { describe, expect, it } from "vitest";
import {
  busyWindowEntries,
  busyWindows,
  eventBlocks,
  eventWindows,
  importNotice,
  type GoogleEvent,
} from "@/lib/googleBusy";

const LA = "America/Los_Angeles";
// October 2026 is PDT (UTC−7) until Nov 1.
const timed = (start: string, end: string, extra: Partial<GoogleEvent> = {}): GoogleEvent => ({
  start: { dateTime: start },
  end: { dateTime: end },
  ...extra,
});

describe("eventBlocks", () => {
  it("blocks an ordinary timed event", () => {
    expect(eventBlocks(timed("2026-10-05T09:00:00-07:00", "2026-10-05T10:00:00-07:00"))).toBe(true);
  });
  it("skips a timed event marked Free", () => {
    expect(
      eventBlocks(timed("2026-10-05T09:00:00-07:00", "2026-10-05T10:00:00-07:00", { transparency: "transparent" }))
    ).toBe(false);
  });
  it("skips cancelled and declined events", () => {
    expect(eventBlocks({ ...timed("2026-10-05T09:00:00-07:00", "2026-10-05T10:00:00-07:00"), status: "cancelled" })).toBe(false);
    expect(
      eventBlocks(
        timed("2026-10-05T09:00:00-07:00", "2026-10-05T10:00:00-07:00", {
          attendees: [{ self: false, responseStatus: "accepted" }, { self: true, responseStatus: "declined" }],
        })
      )
    ).toBe(false);
  });
  it("blocks an all-day event even when Google marks it Free", () => {
    expect(eventBlocks({ start: { date: "2026-10-10" }, end: { date: "2026-10-11" }, transparency: "transparent" })).toBe(true);
  });
});

describe("eventWindows", () => {
  it("places a timed event on the app's clock, not UTC", () => {
    // 02:00–03:30 UTC on the 6th is the evening of the 5th in LA.
    expect(eventWindows(timed("2026-10-06T02:00:00Z", "2026-10-06T03:30:00Z"), LA)).toEqual([
      { ymd: "2026-10-05", startMinute: 19 * 60, endMinute: 20 * 60 + 30 },
    ]);
  });
  it("covers every day of a multi-day all-day event (end date exclusive)", () => {
    expect(eventWindows({ start: { date: "2026-10-10" }, end: { date: "2026-10-13" } }, LA)).toEqual([
      { ymd: "2026-10-10", startMinute: 0, endMinute: 1440 },
      { ymd: "2026-10-11", startMinute: 0, endMinute: 1440 },
      { ymd: "2026-10-12", startMinute: 0, endMinute: 1440 },
    ]);
  });
  it("splits a timed event that runs past midnight", () => {
    expect(eventWindows(timed("2026-10-05T22:00:00-07:00", "2026-10-07T02:00:00-07:00"), LA)).toEqual([
      { ymd: "2026-10-05", startMinute: 22 * 60, endMinute: 1440 },
      { ymd: "2026-10-06", startMinute: 0, endMinute: 1440 },
      { ymd: "2026-10-07", startMinute: 0, endMinute: 120 },
    ]);
  });
  it("adds nothing for the day an event ends exactly at midnight", () => {
    expect(eventWindows(timed("2026-10-05T22:00:00-07:00", "2026-10-06T00:00:00-07:00"), LA)).toEqual([
      { ymd: "2026-10-05", startMinute: 22 * 60, endMinute: 1440 },
    ]);
  });
  it("ignores an event with no usable times", () => {
    expect(eventWindows({}, LA)).toEqual([]);
    expect(eventWindows(timed("2026-10-05T10:00:00-07:00", "2026-10-05T09:00:00-07:00"), LA)).toEqual([]);
  });
});

describe("busyWindows", () => {
  it("merges overlapping and back-to-back events on one day", () => {
    const events = [
      timed("2026-10-05T09:00:00-07:00", "2026-10-05T10:00:00-07:00"),
      timed("2026-10-05T10:00:00-07:00", "2026-10-05T11:00:00-07:00"),
      timed("2026-10-05T10:30:00-07:00", "2026-10-05T12:00:00-07:00"),
      timed("2026-10-05T15:00:00-07:00", "2026-10-05T16:00:00-07:00"),
    ];
    expect(busyWindows(events, "2026-10-01", "2026-10-31", LA)).toEqual([
      { ymd: "2026-10-05", startMinute: 9 * 60, endMinute: 12 * 60 },
      { ymd: "2026-10-05", startMinute: 15 * 60, endMinute: 16 * 60 },
    ]);
  });
  it("lets an all-day event swallow the day's timed ones", () => {
    const events = [
      timed("2026-10-10T09:00:00-07:00", "2026-10-10T10:00:00-07:00"),
      { start: { date: "2026-10-10" }, end: { date: "2026-10-11" } },
    ];
    expect(busyWindows(events, "2026-10-01", "2026-10-31", LA)).toEqual([
      { ymd: "2026-10-10", startMinute: 0, endMinute: 1440 },
    ]);
  });
  it("keeps only the days inside the request's window", () => {
    const events = [{ start: { date: "2026-09-29" }, end: { date: "2026-10-03" } }];
    expect(busyWindows(events, "2026-10-01", "2026-10-31", LA).map((w) => w.ymd)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
  });
  it("drops Free and declined events and sorts by day", () => {
    const events = [
      timed("2026-10-07T09:00:00-07:00", "2026-10-07T10:00:00-07:00"),
      timed("2026-10-06T09:00:00-07:00", "2026-10-06T10:00:00-07:00", { transparency: "transparent" }),
      timed("2026-10-05T18:00:00-07:00", "2026-10-05T19:00:00-07:00"),
    ];
    expect(busyWindows(events, "2026-10-01", "2026-10-31", LA).map((w) => w.ymd)).toEqual([
      "2026-10-05",
      "2026-10-07",
    ]);
  });
});

describe("busyWindowEntries", () => {
  it("dates each block at LOCAL midnight, so the week view draws the right day", () => {
    // A bare "2026-10-05" parses as UTC midnight, which west of Greenwich
    // reads back as the 4th — every previewed block a day early.
    const [entry] = busyWindowEntries([
      { ymd: "2026-10-05", startMinute: 600, endMinute: 720 },
    ]);
    const back = new Date(entry.startDate!);
    expect([back.getFullYear(), back.getMonth(), back.getDate()]).toEqual([2026, 9, 5]);
    expect([back.getHours(), back.getMinutes()]).toEqual([0, 0]);
  });

  it("carries the window and marks it as an import", () => {
    const entries = busyWindowEntries([
      { ymd: "2026-10-05", startMinute: 600, endMinute: 720 },
      { ymd: "2026-10-06", startMinute: 0, endMinute: 1440 },
    ]);
    expect(entries.map((e) => [e.type, e.startMinute, e.endMinute, e.fromGoogle])).toEqual([
      ["SPECIFIC", 600, 720, true],
      ["SPECIFIC", 0, 1440, true],
    ]);
    // Distinct ids: they are React keys in the week view.
    expect(new Set(entries.map((e) => e.id)).size).toBe(2);
  });
});

describe("importNotice", () => {
  it("names how many blocks came in", () => {
    expect(importNotice("3")?.text).toMatch(/Imported 3 blocks/);
    expect(importNotice("1")?.text).toMatch(/Imported 1 block from/);
  });
  it("says so when the calendar was empty", () => {
    expect(importNotice("0")?.text).toMatch(/free throughout/);
  });
  it("explains a refusal and an error", () => {
    expect(importNotice("denied")?.tone).toBe("amber");
    expect(importNotice("error")?.tone).toBe("red");
  });
  it("ignores no param or junk", () => {
    expect(importNotice(null)).toBeNull();
    expect(importNotice("lol")).toBeNull();
  });
});
