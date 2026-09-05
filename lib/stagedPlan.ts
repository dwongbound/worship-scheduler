// Pure helpers for the "Review generated schedule" modal (StagedScheduleModal).
// Kept prisma/react-free so they're trivially unit-testable (see
// tests/unit/stagedPlan.test.ts) and can be shared by the UI.
import type { StagedSet } from "./types";
import { isUserAvailable, type UnavailabilityRule } from "./scheduler";
import type { Instrument } from "./constants";
import {
  DEFAULT_TEAM_ROLES,
  slottedRoles,
  resolveTeamCapacities,
  type TeamRoleDef,
} from "./teamRoles";

// Just the user shape the fill checks need (avoids importing the fat Api type).
interface RosterUser {
  id: string;
  // Teams the user is on, each with the roles they play there (roles are
  // per-team, matching ApiTeamRole). Omitted = membership unknown → only counts
  // for team-less sets. `active` is that team's schedulable flag (absent =
  // active, so callers with older data behave as before).
  teams?: { id: string; roles: Instrument[]; active?: boolean }[];
}

// Whether this user may serve on a set of this team (no team = open to all).
export function isOnTeam(user: RosterUser, teamId: string | null | undefined): boolean {
  return !teamId || (user.teams ?? []).some((t) => t.id === teamId);
}

// The roles a user can fill FOR a set: their roles on the set's team, or the
// union across all their teams for a team-less set ("open to the whole org").
export function rolesForSet(
  user: RosterUser,
  teamId: string | null | undefined
): Instrument[] {
  return teamId
    ? user.teams?.find((t) => t.id === teamId)?.roles ?? []
    : (user.teams ?? []).flatMap((t) => t.roles);
}

// Whether the user is marked ACTIVE for a set's team — i.e. schedulable there.
// Inactive people stay in the pick lists (flagged "(inactive)") but the auto
// fill skips them, so this is what "can we count on them?" checks read. For a
// team-less set, being active on ANY of their teams counts.
export function isActiveForSet(
  user: RosterUser,
  teamId: string | null | undefined
): boolean {
  const teams = user.teams ?? [];
  return teamId
    ? teams.find((t) => t.id === teamId)?.active !== false
    : teams.length === 0 || teams.some((t) => t.active !== false);
}

// Whether the user can fill `role` on a set of this team (per-team roles).
export function playsRoleForSet(
  user: RosterUser,
  role: Instrument,
  teamId: string | null | undefined
): boolean {
  return rolesForSet(user, teamId).includes(role);
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

// How many LOCKED (admin-picked) assignments each user holds across the plan.
// A re-run of "Auto schedule" hands the locked slots to the scheduler as
// `preAssigned`, whose load it deliberately leaves out of the global tally —
// so the modal folds this count into the baseline instead, and a person the
// admin pinned onto three sets isn't treated as free for three more.
export function lockedCounts(sets: StagedSet[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const set of sets) {
    for (const a of set.assignments) {
      if (!a.locked) continue;
      counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
    }
  }
  return counts;
}

// Total locked slots in the plan — the "N locked" hint in the review header.
export function totalLocked(sets: StagedSet[]): number {
  let total = 0;
  for (const c of lockedCounts(sets).values()) total += c;
  return total;
}

// ── Team load metrics ───────────────────────────────────────────────────
// The load panel can measure people by THIS plan or by the sets they're already
// on, so an admin can see "she's on 3 here, but she also played 5 times in the
// last month" before committing.
//
// Anything but "plan" is COUNTED SERVER-SIDE, on demand: GET
// /api/admin/team-load?metric=… returns one tally for the window asked for.
// The plan deliberately doesn't ship a year of assignments with it — the
// windows are opt-in, most runs never leave "In this plan", and a wide one is
// slow enough that it shouldn't be on the critical path of every generate.

// "plan" = assignments in the staged plan. "upcoming" = already-booked sets
// still ahead of us. A NUMBER = that many days back from now.
export type LoadMetric = "plan" | "upcoming" | number;

// The choices the panel's selector offers, in order.
export const LOAD_METRICS: { label: string; metric: LoadMetric }[] = [
  { label: "In this plan", metric: "plan" },
  { label: "Already booked (upcoming)", metric: "upcoming" },
  { label: "Past month", metric: 30 },
  { label: "Past 3 months", metric: 90 },
  { label: "Past 6 months", metric: 182 },
  { label: "Past year", metric: 365 },
];

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
  if (raw === "plan" || raw === "upcoming") return raw;
  const days = Number(raw);
  // Only the windows the picker offers — an arbitrary day count would let a
  // caller ask for an unbounded scan.
  return LOAD_METRICS.some((m) => m.metric === days) ? days : null;
}

/**
 * The [start, end] a metric asks the database for. "upcoming" runs from now
 * with no end; a day count looks back over exactly that many days. "plan" isn't
 * a window at all — it's counted from the staged plan, so it returns null.
 */
export function loadMetricRange(
  metric: LoadMetric,
  now: Date = new Date()
): { start: Date; end: Date | null } | null {
  if (metric === "plan") return null;
  if (metric === "upcoming") return { start: now, end: null };
  return { start: new Date(now.getTime() - metric * MS_PER_DAY), end: now };
}

export interface LoadRow {
  userId: string;
  // The measured number — what the bar draws and sorts on. Equals `planCount`
  // while the panel is showing "In this plan".
  count: number;
  // Always this plan's own tally, so switching the metric never hides the thing
  // the admin is actually editing.
  planCount: number;
}

// Every user assigned in the PLAN (the panel is about the people in it, whatever
// it's measuring), busiest first by the chosen metric. Ties break on id so the
// list is stable across renders and easy to assert in tests.
// `by` overrides the number each row is measured on; omitted = the plan's own.
export function loadRows(
  sets: StagedSet[],
  by?: Map<string, number>
): LoadRow[] {
  return [...countAssignments(sets).entries()]
    .map(([userId, planCount]) => ({
      userId,
      count: by ? by.get(userId) ?? 0 : planCount,
      planCount,
    }))
    .sort((a, b) => b.count - a.count || a.userId.localeCompare(b.userId));
}

// The busiest row's count (0 when there are none) — the scale the load bars are
// drawn relative to. Takes the rows rather than the sets so it always matches
// whatever metric they were built with.
export function maxLoad(rows: LoadRow[]): number {
  let max = 0;
  for (const row of rows) if (row.count > max) max = row.count;
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
  rules: UnavailabilityRule[],
  // The catalog of this set's team. Omitted → the built-in defaults, which is
  // what a team-less set uses.
  catalog: TeamRoleDef[] = DEFAULT_TEAM_ROLES
): Set<Instrument> {
  const caps = resolveTeamCapacities(catalog, set.slotCapacities);
  const onSet = new Set(set.assignments.map((a) => a.userId));
  const cs = calcSet(set);
  const bad = new Set<Instrument>();
  for (const { key: role } of slottedRoles(catalog)) {
    const filled = set.assignments.filter((a) => a.role === role).length;
    if (caps[role] - filled <= 0) continue; // no open slot for this role
    const hasCandidate = users.some(
      (u) =>
        playsRoleForSet(u, role, set.teamId) &&
        // Inactive people don't count: nothing will auto-fill this slot with
        // them, so the hole is still structural.
        isActiveForSet(u, set.teamId) &&
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
  rules: UnavailabilityRule[],
  // teamId → that team's catalog. Sets span teams in one plan, so each is
  // judged against its own roles; a team not in the map uses the defaults.
  catalogs?: Map<string, TeamRoleDef[]>
): number {
  let total = 0;
  for (const set of sets) {
    const catalog =
      (set.teamId ? catalogs?.get(set.teamId) : undefined) ?? DEFAULT_TEAM_ROLES;
    total += unfillableRoles(set, users, rules, catalog).size;
  }
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
