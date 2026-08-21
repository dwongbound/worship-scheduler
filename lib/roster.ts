// Who counts as schedulable, in one place. Both halves of the per-team
// "active" flag live here so the rule is pure data-in/data-out and unit-tested
// (tests/unit/roster.test.ts) rather than buried in prisma `where` clauses:
//
//   schedulableRolesByTeam — the auto-scheduler's view: an INACTIVE membership
//                            is dropped entirely, so buildSchedule can never
//                            propose that person for that team's sets.
//   inactiveMemberIds      — the opposite view, for UI that still SHOWS those
//                            people (the swap picker) but labels them.
import type { Instrument } from "./constants";

// One TeamMember row, as the routes select it.
export interface TeamMembershipRow {
  teamId: string;
  roles: Instrument[];
  active: boolean;
}

/**
 * A user's `rolesByTeam` for the scheduler, with inactive memberships removed.
 * Dropping the entry (rather than emptying its roles) also keeps them out of a
 * team-less set's union — but only for the teams they're paused on.
 */
export function schedulableRolesByTeam(
  memberships: TeamMembershipRow[]
): Record<string, Instrument[]> {
  return Object.fromEntries(
    memberships.filter((m) => m.active).map((m) => [m.teamId, m.roles])
  );
}

/**
 * The user ids that are on the team(s) in `memberships` but switched off —
 * what the swap picker flags as "(inactive)". Someone with several memberships
 * (a team-less set spans the whole org) counts as inactive only when NONE of
 * them are active; someone with no row at all isn't in here, since "not on the
 * team" is a different thing from "paused".
 */
export function inactiveMemberIds(
  memberships: { userId: string; active: boolean }[]
): Set<string> {
  const active = new Set(
    memberships.filter((m) => m.active).map((m) => m.userId)
  );
  return new Set(
    memberships.map((m) => m.userId).filter((id) => !active.has(id))
  );
}
