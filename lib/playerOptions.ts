// The candidate list behind every assignment dropdown (PlayerSelect): who can
// be put in one role slot, and how each of them reads. Shared by the set-detail
// modal and the staged-schedule review modal so the two can't drift, and pure
// so the ordering + flags are unit-tested (tests/unit/playerOptions.test.ts).
//
// Nobody eligible is ever filtered OUT here — people who can't serve at the
// set's time, or who are inactive on its team, stay in the list (labelled and
// dimmed) so an admin can deliberately override. They just sink to the bottom.
import type { PlayerOption } from "@/components/PlayerSelect";
import type { Instrument } from "./constants";
import { isUserAvailable, type SchedulerSet, type UnavailabilityRule } from "./scheduler";
import { isActiveForSet, playsRoleForSet } from "./stagedPlan";

// The user fields the list needs — a subset of ApiAdminUser.
export interface CandidateUser {
  id: string;
  name: string;
  teams?: { id: string; roles: Instrument[]; active?: boolean }[];
}

export function buildPlayerOptions({
  users,
  role,
  teamId,
  set,
  rules,
  exclude,
  serveCounts,
  isMDHere,
}: {
  users: CandidateUser[];
  role: Instrument;
  // The set's team — roles are per-team; null/undefined = open to the whole org.
  teamId: string | null | undefined;
  set: SchedulerSet;
  rules: UnavailabilityRule[];
  // Already on this set in this role (or however the caller defines "taken").
  exclude: Set<string>;
  // Assignments in the surrounding weeks, shown as a muted ×n and used to
  // prefer the least-scheduled. Omit to leave the count off.
  serveCounts?: Map<string, number>;
  // Whether picking this person here would make them an eligible MD. Omit when
  // the caller doesn't surface the "(MD)" hint.
  isMDHere?: (user: CandidateUser) => boolean;
}): PlayerOption[] {
  return users
    .filter((u) => playsRoleForSet(u, role, teamId) && !exclude.has(u.id))
    .map((u) => ({
      id: u.id,
      name: u.name,
      available: isUserAvailable(u.id, set, rules),
      inactive: !isActiveForSet(u, teamId),
      ...(serveCounts ? { count: serveCounts.get(u.id) ?? 0 } : {}),
      ...(isMDHere ? { md: isMDHere(u) } : {}),
    }))
    .sort(
      (a, b) =>
        // Available first, then active, then least-scheduled, then by name.
        Number(b.available) - Number(a.available) ||
        Number(a.inactive) - Number(b.inactive) ||
        (a.count ?? 0) - (b.count ?? 0) ||
        a.name.localeCompare(b.name)
    );
}
