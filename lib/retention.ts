// Data retention: how long a workspace keeps the history it generates.
//
// Sets, rosters, activity-log entries and availability requests accumulate
// forever otherwise — a church running two services a week writes thousands of
// rows a year that nobody will read again. Each org picks how far back to keep;
// everything older is deleted for good on a weekly sweep (lib/retentionStore).
//
// Pure vocabulary only, so the settings page, the confirmation dialog, the API
// and the prune job all agree on the same numbers and words.
// Unit-tested in tests/unit/retention.test.ts.

/** Months of history a new (or untouched) org keeps. */
export const DEFAULT_RETENTION_MONTHS = 12;

/**
 * The choices an admin gets, longest first — the way the dropdown reads, and
 * the order that puts the safest option at the top.
 */
export const RETENTION_OPTIONS = [
  { months: 48, label: "4 years" },
  { months: 24, label: "2 years" },
  { months: 12, label: "1 year" },
  { months: 6, label: "6 months" },
  { months: 3, label: "3 months" },
] as const;

export type RetentionMonths = (typeof RETENTION_OPTIONS)[number]["months"];

/** Is this one of the offered windows? Guards the API against anything else. */
export function isRetentionMonths(value: unknown): value is RetentionMonths {
  return (
    typeof value === "number" &&
    RETENTION_OPTIONS.some((option) => option.months === value)
  );
}

/** "1 year" for a known window; a plain month count for anything else. */
export function retentionLabel(months: number): string {
  const option = RETENTION_OPTIONS.find((o) => o.months === months);
  if (option) return option.label;
  return months === 1 ? "1 month" : `${months} months`;
}

/**
 * The oldest moment a window keeps: anything STRICTLY BEFORE this is deleted.
 *
 * Midnight-anchored, so a sweep's cutoff doesn't drift by the hour it happens
 * to run at. Month arithmetic is done from the 1st and then clamped, because
 * setMonth() on the 31st rolls into the next month (31 March − 1 month would
 * land on 3 March, keeping a month less than asked).
 */
export function retentionCutoff(months: number, now: Date = new Date()): Date {
  const dayOfMonth = now.getDate();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), 1);
  cutoff.setMonth(cutoff.getMonth() - months);
  const lastDayOfCutoffMonth = new Date(
    cutoff.getFullYear(),
    cutoff.getMonth() + 1,
    0
  ).getDate();
  cutoff.setDate(Math.min(dayOfMonth, lastDayOfCutoffMonth));
  return cutoff;
}

/** How often a workspace is swept. Deliberately not daily — see the cron. */
export const PRUNE_INTERVAL_DAYS = 7;

/** Is this org due a sweep? Never-swept orgs are always due. */
export function pruneDue(
  lastPrunedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!lastPrunedAt) return true;
  const elapsedMs = now.getTime() - lastPrunedAt.getTime();
  return elapsedMs >= PRUNE_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}
