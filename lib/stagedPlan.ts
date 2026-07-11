// Pure helpers for the "Review generated schedule" modal (StagedScheduleModal).
// Kept prisma/react-free so they're trivially unit-testable (see
// tests/unit/stagedPlan.test.ts) and can be shared by the UI.
import type { StagedSet } from "./types";
import { isUserAvailable, type UnavailabilityRule } from "./scheduler";
import { ROLE_ORDER, resolveCapacities, type Instrument } from "./constants";

// Just the user shape the fill checks need (avoids importing the fat Api type).
interface RosterUser {
  id: string;
  instruments: Instrument[];
  // Teams the user belongs to (as {id} refs, matching ApiAdminUser.teams).
  // Omitted = membership unknown → only counts for team-less sets.
  teams?: { id: string }[];
}

// Whether this user may serve on a set of this team (no team = open to all).
export function isOnTeam(user: RosterUser, teamId: string | null | undefined): boolean {
  return !teamId || (user.teams ?? []).some((t) => t.id === teamId);
}

// How many staged assignments each user holds across the whole plan. This is
// the "who's playing often" signal the load panel visualizes.
export function countAssignments(sets: StagedSet[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const a of set.assignments) {
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }
  }
  return counts;
}

export interface LoadRow {
  userId: string;
  count: number;
}

// Every assigned user, busiest first (ties broken on id so the list is stable
// across renders and easy to assert in tests).
export function loadRows(sets: StagedSet[]): LoadRow[] {
  return [...countAssignments(sets).entries()]
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
}

// The single busiest person's count (0 when nobody is assigned) — the scale
// the load bars are drawn relative to.
export function maxLoad(sets: StagedSet[]): number {
  let max = 0;
  for (const count of countAssignments(sets).values()) {
    if (count > max) max = count;
  }
  return max;
}

// The scheduler's view of a staged set, for availability checks. StagedSets are
// keyed by their ISO start time, which doubles as a stable id here.
function calcSet(set: StagedSet) {
  return {
    id: set.startsAt,
    startsAt: new Date(set.startsAt),
    durationMinutes: set.durationMinutes,
  };
}

// User ids on this set who are actually UNAVAILABLE at its time — i.e. a manual
// edit (or an existing set) put someone on a set that conflicts with their
// unavailability. The auto-fill never does this, but the editor lets you, so we
// surface it as a warning rather than silently allowing a bad booking.
export function conflictedUserIds(
  set: StagedSet,
  rules: UnavailabilityRule[]
): Set<string> {
  const bad = new Set<string>();
  const cs = calcSet(set);
  for (const a of set.assignments) {
    if (!isUserAvailable(a.userId, cs, rules)) bad.add(a.userId);
  }
  return bad;
}

// Roles on this set that have an open slot NO available person can fill — e.g.
// nobody plays keys, or everyone who does is busy at that time. These are
// structural holes (distinct from a slot the admin just hasn't filled yet), so
// the modal flags them in red.
export function unfillableRoles(
  set: StagedSet,
  users: RosterUser[],
  rules: UnavailabilityRule[]
): Set<Instrument> {
  const caps = resolveCapacities(set.slotCapacities);
  const onSet = new Set(set.assignments.map((a) => a.userId));
  const cs = calcSet(set);
  const bad = new Set<Instrument>();
  for (const role of ROLE_ORDER) {
    const filled = set.assignments.filter((a) => a.role === role).length;
    if (caps[role] - filled <= 0) continue; // no open slot for this role
    const hasCandidate = users.some(
      (u) =>
        u.instruments.includes(role) &&
        isOnTeam(u, set.teamId) &&
        !onSet.has(u.id) &&
        isUserAvailable(u.id, cs, rules)
    );
    if (!hasCandidate) bad.add(role);
  }
  return bad;
}

// Total count of unfillable roles across the whole plan — shown in the header
// banner so the admin knows a hole is structural before applying.
export function totalUnfillable(
  sets: StagedSet[],
  users: RosterUser[],
  rules: UnavailabilityRule[]
): number {
  let total = 0;
  for (const set of sets) total += unfillableRoles(set, users, rules).size;
  return total;
}

// Total number of conflicted (userId, role) slots across the whole plan — the
// count shown in the header so the admin knows to look before applying.
export function totalConflicts(
  sets: StagedSet[],
  rules: UnavailabilityRule[]
): number {
  let total = 0;
  for (const set of sets) {
    const cs = calcSet(set);
    for (const a of set.assignments) {
      if (!isUserAvailable(a.userId, cs, rules)) total++;
    }
  }
  return total;
}
