// "How often is this person already serving?" — the shared vocabulary behind
// both load readouts in the app:
//   • the generate-review modal's Team load panel (StagedScheduleModal), and
//   • the ×n badges in the set detail modal's assignment dropdowns.
// One list of windows so the two can't drift, and pure so the ranges are
// unit-tested (tests/unit/loadMetrics.test.ts).
//
// Everything except "plan" is COUNTED SERVER-SIDE, on demand: GET
// /api/admin/team-load?metric=…&ref=… returns one tally for the window asked
// for, and each client caches the windows it has looked at. Nothing ships a
// year of assignments with the page — the wide windows are opt-in, and picking
// one is what pays for it.

// "plan" = assignments in the staged plan (the create tab's own default, and
// meaningless anywhere else). "calendar-month" = the month the REFERENCE DATE
// falls in. "from-now" = everything still ahead of us. "around-2w" = a
// fortnight either side of the reference date. A NUMBER = that many days back
// from now.
export type LoadMetric =
  | "plan"
  | "calendar-month"
  | "from-now"
  | "around-2w"
  | number;

export interface LoadMetricChoice {
  label: string;
  metric: LoadMetric;
  // Only meaningful where there's a staged plan to count — i.e. the create
  // tab's review modal. Filtered out of the set detail modal's picker.
  planOnly?: true;
}

// Every window either picker can offer, in the order they're listed.
export const LOAD_METRICS: LoadMetricChoice[] = [
  { label: "In this plan", metric: "plan", planOnly: true },
  { label: "Calendar month", metric: "calendar-month" },
  { label: "From now", metric: "from-now" },
  { label: "±2 weeks", metric: "around-2w" },
  { label: "Past month", metric: 30 },
  { label: "Past 3 months", metric: 90 },
  { label: "Past 6 months", metric: 182 },
];

// What each surface offers and opens on. The review modal measures its own
// plan first — that's the thing being edited; the set detail modal has no plan,
// so it opens on the set's own calendar month.
export const PLAN_LOAD_METRICS = LOAD_METRICS;
export const SET_LOAD_METRICS = LOAD_METRICS.filter((m) => !m.planOnly);
export const DEFAULT_PLAN_METRIC: LoadMetric = "plan";
export const DEFAULT_SET_METRIC: LoadMetric = "calendar-month";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A metric as the query string carries it, and back. The wire form is what the
 * client sends and what it keys its per-window cache on, so both sides agree on
 * "30" meaning "the last 30 days".
 */
export function metricToParam(metric: LoadMetric): string {
  return String(metric);
}

/** Parse a `metric` query param; null when it isn't one we serve. */
export function parseLoadMetric(raw: string | null): LoadMetric | null {
  if (raw === null) return null;
  const named = LOAD_METRICS.find((m) => m.metric === raw);
  if (named) return named.metric;
  const days = Number(raw);
  // Only the windows the pickers offer — an arbitrary day count would let a
  // caller ask for an unbounded scan.
  return LOAD_METRICS.some((m) => m.metric === days) ? days : null;
}

/**
 * The [start, end) a metric asks the database for. `end: null` = open-ended.
 *
 * Two clocks are in play on purpose. The windows that describe a NEIGHBOURHOOD
 * — the calendar month, ±2 weeks — hang off `ref`, the thing being looked at
 * (a set's date in the set modal; just now in the review modal, which spans
 * many sets). The ones that describe the PAST or the FUTURE — "from now",
 * "past 3 months" — always hang off `now`, because that's what those words
 * mean regardless of which set is open.
 *
 * "plan" isn't a window at all — it's counted from the staged plan — so it
 * returns null.
 */
export function loadMetricRange(
  metric: LoadMetric,
  { ref, now = new Date() }: { ref?: Date; now?: Date } = {}
): { start: Date; end: Date | null } | null {
  const around = ref ?? now;
  if (metric === "plan") return null;
  if (metric === "from-now") return { start: now, end: null };
  if (metric === "calendar-month") {
    return {
      start: new Date(around.getFullYear(), around.getMonth(), 1),
      // Exclusive: the first instant of the next month (handles December).
      end: new Date(around.getFullYear(), around.getMonth() + 1, 1),
    };
  }
  if (metric === "around-2w") {
    return {
      start: new Date(around.getTime() - 14 * MS_PER_DAY),
      end: new Date(around.getTime() + 14 * MS_PER_DAY),
    };
  }
  return { start: new Date(now.getTime() - metric * MS_PER_DAY), end: now };
}

/** The picker's label for a metric (falls back to the first choice's). */
export function metricLabel(metric: LoadMetric): string {
  return LOAD_METRICS.find((m) => m.metric === metric)?.label ?? LOAD_METRICS[0].label;
}
