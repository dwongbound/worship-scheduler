// The retention window vocabulary: the cutoff maths (which decides what gets
// deleted), the sweep cadence, and the guard the API validates against.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_MONTHS,
  PRUNE_INTERVAL_DAYS,
  RETENTION_OPTIONS,
  isRetentionMonths,
  pruneDue,
  retentionCutoff,
  retentionLabel,
} from "@/lib/retention";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;

describe("the offered windows", () => {
  it("runs longest to shortest, so the safest choice reads first", () => {
    const months = RETENTION_OPTIONS.map((o) => o.months);
    expect(months).toEqual([48, 24, 12, 6, 3]);
  });

  it("defaults to a year, and the year is one of the choices", () => {
    expect(DEFAULT_RETENTION_MONTHS).toBe(12);
    expect(isRetentionMonths(DEFAULT_RETENTION_MONTHS)).toBe(true);
  });

  it("accepts only the offered windows", () => {
    expect(isRetentionMonths(12)).toBe(true);
    expect(isRetentionMonths(3)).toBe(true);
    // A hand-rolled month count would quietly delete almost everything.
    expect(isRetentionMonths(1)).toBe(false);
    expect(isRetentionMonths(0)).toBe(false);
    expect(isRetentionMonths(-12)).toBe(false);
    expect(isRetentionMonths("12")).toBe(false);
    expect(isRetentionMonths(null)).toBe(false);
  });

  it("names each window the way the dropdown does", () => {
    expect(retentionLabel(48)).toBe("4 years");
    expect(retentionLabel(12)).toBe("1 year");
    expect(retentionLabel(3)).toBe("3 months");
    // Anything stored outside the catalog still reads as something.
    expect(retentionLabel(1)).toBe("1 month");
    expect(retentionLabel(7)).toBe("7 months");
  });
});

describe("retentionCutoff", () => {
  it("counts back whole months", () => {
    const now = new Date(2026, 8, 28); // 28 Sep 2026
    expect(ymd(retentionCutoff(12, now))).toBe("2025-09-28");
    expect(ymd(retentionCutoff(3, now))).toBe("2026-06-28");
    expect(ymd(retentionCutoff(48, now))).toBe("2022-09-28");
  });

  it("clamps to the last day of a shorter month instead of rolling over", () => {
    // 31 March − 1 month is not 3 March: subtracting the month naively rolls
    // into the next one and would keep a month LESS than asked for.
    const now = new Date(2026, 2, 31); // 31 Mar 2026
    expect(ymd(retentionCutoff(1, now))).toBe("2026-02-28");
    // And a leap February still gets its 29th.
    expect(ymd(retentionCutoff(12, new Date(2025, 1, 28)))).toBe("2024-02-28");
    expect(ymd(retentionCutoff(1, new Date(2024, 2, 30)))).toBe("2024-02-29");
  });

  it("anchors to midnight, so a sweep's cutoff can't drift by the hour", () => {
    const morning = retentionCutoff(12, new Date(2026, 8, 28, 3, 15));
    const evening = retentionCutoff(12, new Date(2026, 8, 28, 23, 45));
    expect(morning.getTime()).toBe(evening.getTime());
    expect(morning.getHours()).toBe(0);
    expect(morning.getMinutes()).toBe(0);
  });
});

describe("pruneDue", () => {
  const now = new Date(2026, 8, 28);

  it("sweeps an org that has never been swept", () => {
    expect(pruneDue(null, now)).toBe(true);
  });

  it("waits out the interval before sweeping again", () => {
    const day = 24 * 60 * 60 * 1000;
    const yesterday = new Date(now.getTime() - day);
    expect(pruneDue(yesterday, now)).toBe(false);

    const aWeekAgo = new Date(now.getTime() - PRUNE_INTERVAL_DAYS * day);
    expect(pruneDue(aWeekAgo, now)).toBe(true);

    const justShy = new Date(now.getTime() - PRUNE_INTERVAL_DAYS * day + 1000);
    expect(pruneDue(justShy, now)).toBe(false);
  });
});
