// Unit tests for the shared "how often does this person serve?" windows
// (lib/loadMetrics.ts) behind the review modal's Team load panel and the set
// detail modal's ×n badges.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_METRIC,
  DEFAULT_SET_METRIC,
  LOAD_METRICS,
  loadMetricRange,
  metricLabel,
  metricToParam,
  parseLoadMetric,
  PLAN_LOAD_METRICS,
  SET_LOAD_METRICS,
} from "@/lib/loadMetrics";

describe("loadMetricRange", () => {
  const now = new Date(2026, 5, 15, 12, 0); // Mon Jun 15 2026, noon
  // A set three months out — the reference date the set modal passes.
  const ref = new Date(2026, 8, 20, 10, 0); // Sun Sep 20 2026, 10am

  it("asks for everything from now on for 'from-now'", () => {
    const range = loadMetricRange("from-now", { now, ref })!;
    // Anchored on NOW even with a reference date — "from now" means now.
    expect(range.start).toEqual(now);
    expect(range.end).toBeNull(); // open-ended
  });

  it("takes the calendar month around the reference date", () => {
    const range = loadMetricRange("calendar-month", { now, ref })!;
    expect(range.start).toEqual(new Date(2026, 8, 1));
    expect(range.end).toEqual(new Date(2026, 9, 1)); // exclusive
  });

  it("rolls the calendar month over the year boundary", () => {
    const december = new Date(2026, 11, 4, 9, 0);
    const range = loadMetricRange("calendar-month", { ref: december })!;
    expect(range.start).toEqual(new Date(2026, 11, 1));
    expect(range.end).toEqual(new Date(2027, 0, 1));
  });

  it("falls back to now when there's no reference date", () => {
    const range = loadMetricRange("calendar-month", { now })!;
    expect(range.start).toEqual(new Date(2026, 5, 1));
    expect(range.end).toEqual(new Date(2026, 6, 1));
  });

  it("spans a fortnight either side of the reference date", () => {
    const range = loadMetricRange("around-2w", { now, ref })!;
    expect(range.start).toEqual(new Date(2026, 8, 6, 10, 0));
    expect(range.end).toEqual(new Date(2026, 9, 4, 10, 0));
  });

  it("looks back exactly N days from NOW for a numeric window", () => {
    // Past windows ignore the reference date — "past month" is the month just
    // gone, whichever set you happen to have open.
    const month = loadMetricRange(30, { now, ref })!;
    expect(month.end).toEqual(now);
    // 30 days before noon on Jun 15 is noon on May 16.
    expect(month.start).toEqual(new Date(2026, 4, 16, 12, 0));

    // Exactly 182×24h back — wall-clock hour can shift across a DST boundary,
    // which is why this asserts the span rather than a clock time.
    const halfYear = loadMetricRange(182, { now })!;
    expect(now.getTime() - halfYear.start.getTime()).toBe(
      182 * 24 * 60 * 60 * 1000
    );
  });

  it("has no range for the plan itself — that's counted locally", () => {
    expect(loadMetricRange("plan", { now })).toBeNull();
  });
});

describe("parseLoadMetric / metricToParam", () => {
  it("only parses the windows the pickers actually offer", () => {
    expect(parseLoadMetric("plan")).toBe("plan");
    expect(parseLoadMetric("calendar-month")).toBe("calendar-month");
    expect(parseLoadMetric("from-now")).toBe("from-now");
    expect(parseLoadMetric("around-2w")).toBe("around-2w");
    expect(parseLoadMetric("182")).toBe(182);
    // An arbitrary day count would let a caller ask for an unbounded scan.
    expect(parseLoadMetric("99999")).toBeNull();
    expect(parseLoadMetric("nonsense")).toBeNull();
    expect(parseLoadMetric(null)).toBeNull();
  });

  it("round-trips every metric through its query-string form", () => {
    for (const { metric } of LOAD_METRICS) {
      expect(parseLoadMetric(metricToParam(metric))).toBe(metric);
    }
  });
});

describe("what each surface offers", () => {
  it("keeps 'In this plan' out of the set detail modal's picker", () => {
    expect(PLAN_LOAD_METRICS.some((m) => m.metric === "plan")).toBe(true);
    expect(SET_LOAD_METRICS.some((m) => m.metric === "plan")).toBe(false);
    // Otherwise the two lists are the same windows, in the same order.
    expect(SET_LOAD_METRICS).toEqual(
      PLAN_LOAD_METRICS.filter((m) => m.metric !== "plan")
    );
  });

  it("opens each surface on a metric it actually offers", () => {
    expect(PLAN_LOAD_METRICS.some((m) => m.metric === DEFAULT_PLAN_METRIC)).toBe(true);
    expect(SET_LOAD_METRICS.some((m) => m.metric === DEFAULT_SET_METRIC)).toBe(true);
    // Every window the set modal shows is one the server will actually serve.
    for (const { metric } of SET_LOAD_METRICS) {
      expect(loadMetricRange(metric)).not.toBeNull();
    }
  });

  it("labels every metric", () => {
    expect(metricLabel("calendar-month")).toBe("Calendar month");
    expect(metricLabel(90)).toBe("Past 3 months");
  });
});
