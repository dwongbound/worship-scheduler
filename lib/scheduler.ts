// The auto-scheduling algorithm. Deliberately pure: no prisma, no next.js —
// plain data in, plain data out — so it's trivially unit-testable with
// vitest (see tests/unit/scheduler.test.ts).
//
// Strategy: greedy fill with load balancing.
//   1. Walk sets chronologically.
//   2. For each role slot (scarce roles first, per ROLE_ORDER), pick the
//      candidate who (a) plays that instrument, (b) is available, (c) isn't
//      already on this set, and (d) has the FEWEST assignments so far.
//   3. Ties break on user id so results are deterministic (nice for tests).
// Slots with no viable candidate stay empty rather than blocking the run.

import {
  ROLE_ORDER,
  resolveCapacities,
  type Instrument,
  type SlotCapacityMap,
} from "./constants";

export interface SchedulerUser {
  id: string;
  instruments: Instrument[];
}

export interface SchedulerSet {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  // The set's own team shape. Omitted → the global SLOT_CAPACITIES default.
  capacities?: SlotCapacityMap | null;
}

// Mirrors the Unavailability prisma model (times the user CANNOT serve).
export interface UnavailabilityRule {
  userId: string;
  type: "RECURRING" | "DATE_RANGE";
  dayOfWeek?: number | null; // 0 = Sunday ... 6 = Saturday
  startMinute?: number | null; // minutes from midnight
  endMinute?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface ProposedAssignment {
  setId: string;
  userId: string;
  role: Instrument;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True if no unavailability rule blocks this user from this set.
 * Recurring rules block when the day matches and the time windows overlap;
 * date-range rules block any set starting within the range (inclusive).
 */
export function isUserAvailable(
  userId: string,
  set: SchedulerSet,
  rules: UnavailabilityRule[]
): boolean {
  for (const rule of rules) {
    if (rule.userId !== userId) continue;

    if (rule.type === "RECURRING") {
      if (set.startsAt.getDay() !== rule.dayOfWeek) continue;
      const setStart = set.startsAt.getHours() * 60 + set.startsAt.getMinutes();
      const setEnd = setStart + set.durationMinutes;
      const ruleStart = rule.startMinute ?? 0;
      const ruleEnd = rule.endMinute ?? 24 * 60;
      // Standard half-open interval overlap check.
      if (setStart < ruleEnd && setEnd > ruleStart) return false;
    } else {
      // DATE_RANGE — endDate is stored at midnight, so extend it to the
      // end of that day to make the range inclusive.
      const t = set.startsAt.getTime();
      const start = rule.startDate ? rule.startDate.getTime() : -Infinity;
      const end = rule.endDate
        ? rule.endDate.getTime() + MS_PER_DAY - 1
        : Infinity;
      if (t >= start && t <= end) return false;
    }
  }
  return true;
}

/**
 * Fill every set's slots from the pool of users.
 * `existingCounts` lets callers pre-load how many assignments each user
 * already has (so re-runs stay balanced against prior schedules).
 */
export function buildSchedule(
  sets: SchedulerSet[],
  users: SchedulerUser[],
  rules: UnavailabilityRule[],
  existingCounts: Map<string, number> = new Map()
): ProposedAssignment[] {
  // Running tally of assignments per user — the load-balancing signal.
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.id, existingCounts.get(u.id) ?? 0);

  const proposals: ProposedAssignment[] = [];
  const chronological = [...sets].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  for (const set of chronological) {
    const alreadyOnSet = new Set<string>(); // one slot per person per set
    const capacities = resolveCapacities(set.capacities); // set's team shape

    for (const role of ROLE_ORDER) {
      const capacity = capacities[role];

      for (let slot = 0; slot < capacity; slot++) {
        const candidates = users
          .filter((u) => u.instruments.includes(role))
          .filter((u) => !alreadyOnSet.has(u.id))
          .filter((u) => isUserAvailable(u.id, set, rules))
          .sort(
            (a, b) =>
              counts.get(a.id)! - counts.get(b.id)! ||
              a.id.localeCompare(b.id)
          );

        const pick = candidates[0];
        if (!pick) break; // nobody left for this role — leave slot empty

        alreadyOnSet.add(pick.id);
        counts.set(pick.id, counts.get(pick.id)! + 1);
        proposals.push({ setId: set.id, userId: pick.id, role });
      }
    }
  }

  return proposals;
}
