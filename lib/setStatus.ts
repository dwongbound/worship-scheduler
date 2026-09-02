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
  slottedRoles,
  resolveTeamCapacities,
  type TeamRoleDef,
} from "./teamRoles";
import type { AssignmentStatus, SlotCapacityMap } from "./constants";
import { openSeats, type GuestTeamConfig } from "./guestTeams";

export type SetStatus = "understaffed" | "confirmed" | "unconfirmed" | "cover";

// What setStatus needs off a set — only the fields it reads, so the calendar's
// ApiSet and the staged-plan shape both satisfy it without a cast. A set
// without its team's catalog falls back to the built-in roles, which is also
// what a team-less ("open to the whole org") set uses.
export type StatusSet = {
  assignments: { role: string; status: AssignmentStatus; guestTeamId?: string | null }[];
  slotCapacities?: SlotCapacityMap | null;
  team?: { roles?: TeamRoleDef[] } | null;
  // Borrowed seats from other teams, if the caller loaded them. Absent = none.
  guestTeams?: GuestTeamConfig[] | null;
};

/**
 * How many roster slots this set still has open — its shape minus who's on it.
 *
 * Counts the owning team's slots plus every guest team's COUNTED seats. A
 * guest role marked `allAvailable` is skipped: it has no target number, so it
 * can't be short, and a set that borrows "however many singers are free" never
 * reads as understaffed on that account.
 */
export function openSlotCount(set: StatusSet): number {
  const catalog = set.team?.roles ?? DEFAULT_TEAM_ROLES;
  const caps = resolveTeamCapacities(catalog, set.slotCapacities);
  let open = 0;
  // The owning team's own seats — assignments borrowed from a guest team don't
  // fill them, so only non-guest assignments count here.
  for (const { key } of slottedRoles(catalog)) {
    const filled = set.assignments.filter(
      (a) => a.role === key && !a.guestTeamId
    ).length;
    open += Math.max(0, (caps[key] ?? 0) - filled);
  }
  for (const guest of set.guestTeams ?? []) {
    for (const spec of guest.roles) {
      const filled = set.assignments.filter(
        (a) => a.role === spec.role && a.guestTeamId === guest.id
      ).length;
      open += openSeats(spec, filled);
    }
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
