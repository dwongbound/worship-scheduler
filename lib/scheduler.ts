// The auto-scheduling algorithm. Deliberately pure: no prisma, no next.js —
// plain data in, plain data out — so it's trivially unit-testable with
// vitest (see tests/unit/scheduler.test.ts).
//
// Strategy: greedy fill with load balancing and spacing.
//   1. Walk sets chronologically.
//   2. For each role slot (scarce roles first, per ROLE_ORDER), pick the
//      candidate who (a) plays that instrument, (b) is available, (c) isn't
//      already on this set, then prefer (d) people who did NOT serve within
//      the past week (soft — see SPACING below), and among those (e) whoever
//      has the FEWEST assignments so far.
//   3. Ties break on user id so results are deterministic (nice for tests).
// Slots with no viable candidate stay empty rather than blocking the run.
//
// SPACING: someone who served (or is being scheduled) within MIN_GAP_DAYS of
// a set is deprioritized for it, not excluded — with enough people this makes
// weekly sets rotate round-robin, but a small pool still gets fully staffed.
// Callers can feed `existingAssignments` (already-booked set dates from the
// DB) so one-off sets also avoid people who just served nearby.

import {
  MD_ROLES,
  ROLE_ORDER,
  resolveCapacities,
  rolesMayOverlap,
  type Instrument,
  type SlotCapacityMap,
} from "./constants";

export interface SchedulerUser {
  id: string;
  instruments: Instrument[];
  // True if this person can serve as a set's musical director.
  isMD?: boolean;
  // Teams this person belongs to. Only consulted when a set has a teamId.
  teamIds?: string[];
}

export interface SchedulerSet {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  // The team this set is for. When present, only users whose teamIds include
  // it are considered; null/omitted = open to everyone.
  teamId?: string | null;
  // The set's own team shape. Omitted → the global SLOT_CAPACITIES default.
  capacities?: SlotCapacityMap | null;
  // When true, reserve one slot for an available MD before the normal fill.
  requiresMD?: boolean;
  // Slots already filled before this run (e.g. hand-picked by an admin).
  // They're hard constraints the fill works around: each consumes one slot of
  // its role, its person is never proposed again on this set, and an MD among
  // them (in an MD-capable role) satisfies requiresMD. Never re-proposed.
  // NOTE: their load is NOT added to the balancing tally here — fold it into
  // `existingCounts` if it should count (a db-wide count already includes it).
  preAssigned?: { userId: string; role: Instrument; isMD?: boolean }[];
}

// Mirrors the Unavailability prisma model (times the user CANNOT serve).
export interface UnavailabilityRule {
  userId: string;
  type: "RECURRING" | "SPECIFIC" | "DATE_RANGE";
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

// A date someone is already booked on (from the DB), for the spacing rule.
export interface ExistingAssignment {
  userId: string;
  startsAt: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Two bookings closer together than this are "too close": the person is
// deprioritized (never excluded). 8 days so exactly-a-week-apart recurring
// sets count as back-to-back weeks.
const MIN_GAP_DAYS = 8;

// Midnight of the given date's calendar day (drops the time component) so we
// can compare two dates by day regardless of their clock times.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

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

    if (rule.type === "RECURRING" || rule.type === "SPECIFIC") {
      // RECURRING applies on every matching weekday. SPECIFIC applies on its
      // startDate, or across [startDate, endDate] when an end date is set (a
      // multi-day block). Both then check time-window overlap.
      if (rule.type === "RECURRING") {
        if (set.startsAt.getDay() !== rule.dayOfWeek) continue;
      } else {
        if (!rule.startDate) continue;
        // Compare by calendar day so a set anywhere within the day-range is
        // blocked (endDate defaults to startDate → a single day).
        const setDay = startOfDay(set.startsAt);
        const startDay = startOfDay(rule.startDate);
        const endDay = rule.endDate ? startOfDay(rule.endDate) : startDay;
        if (setDay < startDay || setDay > endDay) continue;
      }
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
 * `existingAssignments` are dates people are already booked on in the DB, so
 * the spacing rule can also steer new sets away from them.
 */
export function buildSchedule(
  sets: SchedulerSet[],
  users: SchedulerUser[],
  rules: UnavailabilityRule[],
  existingCounts: Map<string, number> = new Map(),
  existingAssignments: ExistingAssignment[] = []
): ProposedAssignment[] {
  // Running tally of assignments per user — the load-balancing signal.
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.id, existingCounts.get(u.id) ?? 0);

  // Every date each person is booked on (DB bookings + picks made during this
  // run) — the spacing signal. See tooClose below.
  const bookedTimes = new Map<string, number[]>();
  for (const a of existingAssignments) {
    const times = bookedTimes.get(a.userId) ?? [];
    times.push(a.startsAt.getTime());
    bookedTimes.set(a.userId, times);
  }
  const recordBooking = (userId: string, time: number) => {
    const times = bookedTimes.get(userId) ?? [];
    times.push(time);
    bookedTimes.set(userId, times);
  };
  // True when the person already has a booking within MIN_GAP_DAYS of `time`
  // (either side) — they served too recently, or are about to serve again.
  const tooClose = (userId: string, time: number): boolean => {
    const times = bookedTimes.get(userId);
    if (!times) return false;
    return times.some(
      (t) => t !== time && Math.abs(t - time) < MIN_GAP_DAYS * MS_PER_DAY
    );
  };

  const proposals: ProposedAssignment[] = [];
  const chronological = [...sets].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  for (const set of chronological) {
    const setTime = set.startsAt.getTime();
    const preAssigned = set.preAssigned ?? [];
    // Roles each person already holds on this set — seeded with the pre-assigned
    // people. Normally one slot per person, but one person may hold BOTH worship
    // leader and acoustic guitar (OVERLAP_ALLOWED_ROLES); see canTakeRole.
    const rolesOnSet = new Map<string, Set<Instrument>>();
    for (const p of preAssigned) {
      const held = rolesOnSet.get(p.userId) ?? new Set<Instrument>();
      held.add(p.role);
      rolesOnSet.set(p.userId, held);
      // Their presence here counts for spacing on the surrounding sets too.
      recordBooking(p.userId, setTime);
    }
    // Remaining slots per role — starts at the set's shape, decremented as we
    // fill (the MD reservation below eats into it before the normal pass).
    const remaining = resolveCapacities(set.capacities);
    // Pre-assigned slots are already taken (an overfilled role just goes
    // negative, which the fill loop treats as full).
    for (const p of preAssigned) remaining[p.role]--;

    // Whether `userId` may additionally take `role`. Enforces one role per
    // person, minus the sanctioned overlaps: the new role must be allowed to
    // pair with EVERY role they already hold (see rolesMayOverlap).
    const canTakeRole = (userId: string, role: Instrument): boolean => {
      const held = rolesOnSet.get(userId);
      if (!held || held.size === 0) return true; // no role yet
      if (held.has(role)) return false; // already in this exact role
      for (const r of held) if (!rolesMayOverlap(r, role)) return false;
      return true;
    };

    // Commit a pick: record it and update all running tallies.
    const assign = (userId: string, role: Instrument) => {
      const held = rolesOnSet.get(userId) ?? new Set<Instrument>();
      held.add(role);
      rolesOnSet.set(userId, held);
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
      recordBooking(userId, setTime);
      remaining[role]--;
      proposals.push({ setId: set.id, userId, role });
    };

    // Pick the best candidate for a role, honoring availability and the
    // one-slot-per-person rule (plus its lone overlap exception). Preference
    // order: people NOT booked within MIN_GAP_DAYS of this set first (the
    // spacing rule — soft, so a small pool still fills every slot), then the
    // least-loaded, then user id for determinism. Optional `mdOnly` restricts
    // to MDs. When a set doesn't add an MD (requiresMD off), MDs are excluded
    // from it entirely — an MD is only ever assigned to a set that opted in.
    const bestFor = (role: Instrument, mdOnly = false) =>
      users
        .filter(
          // Team-restricted set: only its members may be scheduled on it.
          (u) => !set.teamId || (u.teamIds ?? []).includes(set.teamId)
        )
        .filter((u) => (mdOnly ? u.isMD : true))
        .filter((u) => set.requiresMD || !u.isMD)
        .filter((u) => u.instruments.includes(role))
        .filter((u) => canTakeRole(u.id, role))
        .filter((u) => isUserAvailable(u.id, set, rules))
        .sort(
          (a, b) =>
            Number(tooClose(a.id, setTime)) - Number(tooClose(b.id, setTime)) ||
            counts.get(a.id)! - counts.get(b.id)! ||
            a.id.localeCompare(b.id)
        )[0];

    // ── MD reservation ──────────────────────────────────────────────────
    // If this set needs an MD, seat one first so the greedy fill can't use up
    // every slot an MD could take. An MD can only lead from an MD_ROLE (keys,
    // electric guitar, or bass), so we only consider those — scarcest first
    // (ROLE_ORDER is scarce-first). If no eligible MD is available, the set is
    // left without one — surfaced to the admin rather than blocking the run.
    // A pre-assigned MD already sitting in an MD role satisfies the need.
    const hasPreMD = preAssigned.some(
      (p) => p.isMD && MD_ROLES.includes(p.role)
    );
    if (set.requiresMD && !hasPreMD) {
      for (const role of ROLE_ORDER) {
        if (!MD_ROLES.includes(role)) continue;
        if (remaining[role] <= 0) continue;
        const md = bestFor(role, true);
        if (md) {
          assign(md.id, role);
          break;
        }
      }
    }

    // ── Normal greedy fill of the remaining slots ───────────────────────
    for (const role of ROLE_ORDER) {
      while (remaining[role] > 0) {
        const pick = bestFor(role);
        if (!pick) break; // nobody left for this role — leave slot empty
        assign(pick.id, role);
      }
    }
  }

  return proposals;
}
