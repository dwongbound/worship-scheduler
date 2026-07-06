// Unit tests for the stats widget helper (lib/stats.ts).
import { describe, expect, it } from "vitest";
import { countSetsInWindow, rangeForDays } from "@/lib/stats";

const NOW = new Date(2026, 0, 1, 12, 0); // Jan 1 2026, noon

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("countSetsInWindow", () => {
  const sets = [
    daysFromNow(-1), // yesterday — never counted
    daysFromNow(2), // within a week
    daysFromNow(6), // within a week
    daysFromNow(20), // within a month
    daysFromNow(75), // within 3 months
    daysFromNow(200), // beyond every window
  ];

  it("counts only future sets inside 1 week", () => {
    expect(countSetsInWindow(sets, 7, NOW)).toBe(2);
  });

  it("counts sets inside 1 month", () => {
    expect(countSetsInWindow(sets, 30, NOW)).toBe(3);
  });

  it("counts sets inside 3 months", () => {
    expect(countSetsInWindow(sets, 90, NOW)).toBe(4);
  });

  it("returns 0 for an empty list", () => {
    expect(countSetsInWindow([], 7, NOW)).toBe(0);
  });
});

describe("rangeForDays", () => {
  it("runs now → future for a positive window", () => {
    const { start, end } = rangeForDays(7, NOW);
    expect(start).toEqual(NOW);
    expect(end).toEqual(daysFromNow(7));
  });

  it("runs past → now for a negative window", () => {
    const { start, end } = rangeForDays(-365, NOW);
    expect(start).toEqual(daysFromNow(-365));
    expect(end).toEqual(NOW);
  });
});
