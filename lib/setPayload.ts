// The one shape a set goes over the wire in.
//
// GET /api/sets (a window of them) and GET /api/sets/[id] (one, for a ?set=
// deep link) must return the SAME object — the calendar's detail modal doesn't
// care which one it came from — so the prisma include and the pending-owner
// pass live here rather than being written out twice.
//
// Server-only (prisma).
import { pendingOwners, type HandoffSeat, type PendingOwner } from "./pendingHandoff";
import { TEAM_ROLE_FIELDS } from "./teamRoleStore";

export const SET_INCLUDE = {
  org: { select: { id: true, name: true } },
  // The team's role catalog rides along: the roster, capacity editor and
  // auto-fill all read a set's roles from ITS team, never a fixed list.
  team: {
    select: {
      id: true,
      name: true,
      roles: { select: TEAM_ROLE_FIELDS, orderBy: { order: "asc" } },
    },
  },
  assignments: {
    include: { user: { select: { id: true, name: true, isMD: true } } },
  },
  // Teams lending people to this set. Each carries its OWN catalog, since
  // borrowed seats are named and filled from the guest team's roles rather
  // than the owning team's (see lib/guestTeams.ts).
  guestTeams: {
    select: {
      id: true,
      teamId: true,
      roles: true,
      team: {
        select: {
          id: true,
          name: true,
          roles: { select: TEAM_ROLE_FIELDS, orderBy: { order: "asc" } },
        },
      },
    },
  },
  songs: { orderBy: { order: "asc" } },
} as const;

/**
 * Stamp each seat with the person it still belongs to while a cover/swap on it
 * waits for approval (null on a settled seat). One lookup for the whole batch —
 * see lib/pendingHandoff.ts for why the taker isn't the whole story.
 */
export async function withPendingOwners<
  A extends HandoffSeat,
  S extends { assignments: A[] },
>(
  sets: S[]
): Promise<
  (Omit<S, "assignments"> & {
    assignments: (A & { pendingFromUser: PendingOwner | null })[];
  })[]
> {
  const owners = await pendingOwners(sets.flatMap((s) => s.assignments));
  return sets.map((s) => ({
    ...s,
    assignments: s.assignments.map((a) => ({
      ...a,
      pendingFromUser: owners.get(a.id) ?? null,
    })),
  }));
}
