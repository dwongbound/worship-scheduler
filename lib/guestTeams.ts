// Guest teams: another team lending its people to a set it doesn't own.
//
// A set still has exactly ONE owning team — its Slack channel, availability
// requests and org anchor never move. A guest row only widens who may sit in
// which seats: it names roles FROM THE GUEST TEAM'S OWN CATALOG and how many
// of each this set borrows.
//
// A seat is one of two shapes:
//   { role, count }              — n fixed slots, filled and counted like any
//                                  other role (an unfilled one is a hole).
//   { role, allAvailable: true } — an unbounded list: no target, so it never
//                                  reads as a hole, and "Auto schedule" seats
//                                  everyone free rather than a balanced few.
//                                  This is what the old hardcoded choir did —
//                                  now available to any team's any role.
//
// Pure (no prisma, no react) so the rules are unit-tested directly — see
// tests/unit/guestTeams.test.ts.
import { MAX_SLOTS_PER_ROLE } from "./constants";

// The most guest teams one set may borrow from. A guard on pathological input
// rather than a meaningful ministry limit.
export const MAX_GUEST_TEAMS_PER_SET = 8;

/** One borrowed role: either a fixed count of seats, or an unbounded list. */
export type GuestRoleSpec =
  | { role: string; count: number; allAvailable?: false }
  | { role: string; allAvailable: true; count?: undefined };

/** A set's guest row as the API returns it. */
export interface GuestTeamConfig {
  id: string;
  teamId: string;
  roles: GuestRoleSpec[];
}

/**
 * Whether this seat is the unbounded kind (no target count). A type predicate,
 * so callers that branch on it get `count` narrowed on the other side.
 */
export function isUnbounded(
  spec: GuestRoleSpec
): spec is Extract<GuestRoleSpec, { allAvailable: true }> {
  return spec.allAvailable === true;
}

/**
 * How many EMPTY seats to show for a guest role given who already sits in it.
 *
 * An unbounded seat has no target, so it reports zero open slots — that's what
 * keeps an "add as many as are available" choir from making a set read
 * understaffed. (The UI still offers one spare "add someone" row; that's a
 * rendering affordance, not an unfilled requirement.)
 */
export function openSeats(spec: GuestRoleSpec, filled: number): number {
  if (isUnbounded(spec)) return 0;
  return Math.max(0, spec.count - filled);
}

/**
 * Parse/validate a guest team's `roles` JSON.
 *
 * `allowedKeys` is the GUEST team's catalog keys — a set can only borrow roles
 * that team actually has. Returns the cleaned list, or null when the input is
 * malformed (the caller turns that into a 400). Duplicate roles collapse to the
 * last one so a double-tick can't create two seats for the same role.
 */
export function validateGuestRoles(
  raw: unknown,
  allowedKeys: string[]
): GuestRoleSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const allowed = new Set(allowedKeys);
  const byRole = new Map<string, GuestRoleSpec>();

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { role, count, allAvailable } = entry as Record<string, unknown>;
    if (typeof role !== "string" || !allowed.has(role)) return null;

    if (allAvailable === true) {
      byRole.set(role, { role, allAvailable: true });
      continue;
    }
    // A counted seat needs a whole number in range. 0 is allowed (it's how the
    // UI represents "borrow this role but no seats yet"), but the caller
    // normally drops those before saving.
    if (typeof count !== "number" || !Number.isInteger(count)) return null;
    if (count < 0 || count > MAX_SLOTS_PER_ROLE) return null;
    byRole.set(role, { role, count });
  }
  return [...byRole.values()];
}

/**
 * Every user id already sitting on this set, in ANY seat (owning team or
 * guest). The guest auto-fill subtracts these: someone already playing bass on
 * the set shouldn't also be pulled into the visiting choir.
 */
export function usersOnSet(
  assignments: { userId: string }[]
): Set<string> {
  return new Set(assignments.map((a) => a.userId));
}
