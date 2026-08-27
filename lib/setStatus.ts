// A set's overall status, derived from how full its roster is and what state
// the people on it are in. One source of truth for the calendar's colored
// status dot AND the calendar filters.
//
// Precedence mirrors the dot: a cover request (red) beats an unfilled slot
// (red) beats anyone still pending (amber) beats fully confirmed (green). The
// two reds are separate statuses because the filters distinguish them even
// though the dot doesn't — and because they need different fixes.
import {
  DEFAULT_TEAM_ROLES,
  bandRoles,
  resolveTeamCapacities,
  type TeamRoleDef,
} from "./teamRoles";
import type { AssignmentStatus, SlotCapacityMap } from "./constants";

export type SetStatus = "understaffed" | "confirmed" | "unconfirmed" | "cover";

// What setStatus needs off a set — only the fields it reads, so the calendar's
// ApiSet and the staged-plan shape both satisfy it without a cast. A set
// without its team's catalog falls back to the built-in roles, which is also
// what a team-less ("open to the whole org") set uses.
export type StatusSet = {
  assignments: { role: string; status: AssignmentStatus }[];
  slotCapacities?: SlotCapacityMap | null;
  team?: { roles?: TeamRoleDef[] } | null;
};

/**
 * How many roster slots this set still has open — its team shape minus who's
 * on it. Choir is excluded (bandRoles drops it), so an opt-in choir never
 * reads as a hole.
 */
export function openSlotCount(set: StatusSet): number {
  const catalog = set.team?.roles ?? DEFAULT_TEAM_ROLES;
  const caps = resolveTeamCapacities(catalog, set.slotCapacities);
  let open = 0;
  for (const { key } of bandRoles(catalog)) {
    const filled = set.assignments.filter((a) => a.role === key).length;
    open += Math.max(0, (caps[key] ?? 0) - filled);
  }
  return open;
}

export function setStatus(set: StatusSet): SetStatus {
  if (set.assignments.some((a) => a.status === "SWAP_REQUESTED")) return "cover";
  // Nobody at all is understaffed by definition — including a deliberately
  // emptied placeholder set, which is exactly the state that should shout.
  // The count check alone would call a set with an all-zero shape "confirmed".
  if (set.assignments.length === 0 || openSlotCount(set) > 0) {
    return "understaffed";
  }
  // A slot pending confirmation OR pending admin approval isn't settled yet.
  if (
    set.assignments.some(
      (a) => a.status === "PENDING" || a.status === "PENDING_APPROVAL"
    )
  )
    return "unconfirmed";
  return "confirmed";
}
