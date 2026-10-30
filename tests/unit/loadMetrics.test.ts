// Unit tests for the shared "how often does this person serve?" windows
// (lib/loadMetrics.ts) behind the review modal's Team load panel and the set
// detail modal's ×n badges.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAN_METRIC,
  LOAD_METRICS,
  loadMetricRange,
  metricLabel,
  metricToParam,
  parseLoadMetric,
  PLAN_LOAD_METRICS,
  SET_LOAD_METRIC,
  serveMonthLabel,
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
  it("offers the plan window only where there is a plan", () => {
    expect(PLAN_LOAD_METRICS.some((m) => m.metric === "plan")).toBe(true);
  });

  it("opens the review workspace on a metric it actually offers", () => {
    expect(PLAN_LOAD_METRICS.some((m) => m.metric === DEFAULT_PLAN_METRIC)).toBe(true);
    // Every window that picker shows is one the server will actually serve.
    for (const { metric } of PLAN_LOAD_METRICS) {
      if (metric === "plan") continue; // counted from the plan, not queried
      expect(loadMetricRange(metric)).not.toBeNull();
    }
  });

  it("gives the set detail modal one fixed window, the set's own month", () => {
    // There is no picker there any more, so this is the whole answer rather
    // than a default — and the server has to serve it.
    expect(SET_LOAD_METRIC).toBe("calendar-month");
    expect(parseLoadMetric(metricToParam(SET_LOAD_METRIC))).toBe(SET_LOAD_METRIC);
    expect(loadMetricRange(SET_LOAD_METRIC)).not.toBeNull();
  });

  it("labels every metric", () => {
    expect(metricLabel("calendar-month")).toBe("Calendar month");
    expect(metricLabel(90)).toBe("Past 3 months");
  });
});

describe("naming the month the \u00d7N counts", () => {
  // The set detail modal has no window picker any more, so its tooltip and the
  // badge's own title have to say WHICH month the number covers.
  const now = new Date(2026, 9, 27); // 27 Oct 2026

  it("names a month in the current year without the year", () => {
    expect(serveMonthLabel(new Date(2026, 10, 8), now)).toBe("November");
  });

  it("adds the year once the set is in another one", () => {
    expect(serveMonthLabel(new Date(2027, 0, 3), now)).toBe("January 2027");
  });

  it("takes the ISO string the API hands back", () => {
    expect(serveMonthLabel(new Date(2026, 9, 27).toISOString(), now)).toBe(
      "October"
    );
  });

  it("falls back to plain words rather than 'Invalid Date'", () => {
    expect(serveMonthLabel("not a date", now)).toBe("this month");
  });
});
