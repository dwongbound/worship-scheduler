// Pure set-related logic, kept out of the route/component bodies so it can be
// unit-tested directly (see tests/unit/sets.test.ts). Three rules live here:
//   1. selectUpcomingSets — what the calendar's "Upcoming sets" drawer shows.
//   2. canViewSet         — who may see a private set.
//   3. coverEligibility   — who may take a swap-requested slot as a cover.
import type { Instrument } from "./constants";
import type { ApiAssignment, ApiSet } from "./types";

// ── 1. Calendar drawer ───────────────────────────────────────────────────
// One upcoming set paired with the roles (if any) the viewer plays on it.
export interface UpcomingSetRow {
  set: ApiSet;
  mine: ApiAssignment[]; // the viewer's slots on this set (empty = not theirs)
}

// The rows the "Upcoming sets" drawer renders. By default (scope "all") every
// still-upcoming set is included; scope "mine" narrows to sets the viewer holds
// a slot on. Soonest-first, or — with sortBy "unconfirmed" — the viewer's
// still-pending sets floated to the top (sets they aren't on have no pending
// slot, so they sink below). `now` is injectable so tests are deterministic.
export function selectUpcomingSets(
  sets: ApiSet[],
  myId: string | undefined,
  opts: { scope: "all" | "mine"; sortBy: "date" | "unconfirmed"; now?: number }
): UpcomingSetRow[] {
  const now = opts.now ?? Date.now();
  let rows: UpcomingSetRow[] = sets
    .filter((set) => new Date(set.startsAt).getTime() >= now)
    .map((set) => ({
      set,
      mine: myId ? set.assignments.filter((a) => a.user.id === myId) : [],
    }))
    .sort((a, b) => a.set.startsAt.localeCompare(b.set.startsAt));

  if (opts.scope === "mine") rows = rows.filter((row) => row.mine.length > 0);

  if (opts.sortBy === "unconfirmed") {
    // Stable partition: sets the viewer still owes a confirmation on first,
    // keeping soonest-first order within each group.
    const pending = (row: UpcomingSetRow) =>
      row.mine.some((a) => a.status === "PENDING");
    rows.sort((a, b) => Number(pending(b)) - Number(pending(a)));
  }
  return rows;
}

// ── 2. Private-set visibility ────────────────────────────────────────────
// A private set is visible only to org admins and the people assigned to it;
// a normal (public) set is visible to anyone in its org. Mirrors the OR filter
// GET /api/sets applies in the database, and guards the single-set export.
export function canViewSet(
  set: { isPrivate: boolean; assignedUserIds: string[] },
  viewer: { userId: string; isOrgAdmin: boolean }
): boolean {
  if (!set.isPrivate) return true;
  return viewer.isOrgAdmin || set.assignedUserIds.includes(viewer.userId);
}

// ── 3. Swap-cover eligibility ────────────────────────────────────────────
export interface CoverEligibilityInput {
  viewerId: string;
  ownerId: string; // who currently holds the swap-requested slot
  assignmentStatus: string; // must be "SWAP_REQUESTED" to be takeable
  viewerInstruments: Instrument[];
  role: Instrument; // the slot's instrument
  viewerOrgIds: string[]; // orgs the viewer belongs to
  setOrgId: string;
  setTeamId: string | null; // null = the set is open to the whole org
  viewerOnTeam: boolean; // is the viewer a member of the set's team?
  alreadyInRole: boolean; // does the viewer already fill THIS role on the set?
}

export type CoverEligibility =
  | { ok: true }
  | { ok: false; status: number; error: string };

// Whether the viewer may take a swap-requested slot. The checks (and their
// status codes) mirror POST /api/swaps/:id/take, in order: an out-of-org or
// non-open request "doesn't exist" (404 masks it); a team set is coverable only
// by its members (a team-less set stays org-wide); you can't take your own
// swap, cover an instrument you don't play, or double up on a role you already
// hold on that set.
export function coverEligibility(i: CoverEligibilityInput): CoverEligibility {
  if (
    i.assignmentStatus !== "SWAP_REQUESTED" ||
    !i.viewerOrgIds.includes(i.setOrgId)
  ) {
    return { ok: false, status: 404, error: "Swap request not found" };
  }
  if (i.setTeamId && !i.viewerOnTeam) {
    return { ok: false, status: 403, error: "This cover is for another team" };
  }
  if (i.ownerId === i.viewerId) {
    return { ok: false, status: 400, error: "Cannot take your own swap" };
  }
  if (!i.viewerInstruments.includes(i.role)) {
    return { ok: false, status: 400, error: "You don't play this instrument" };
  }
  if (i.alreadyInRole) {
    return {
      ok: false,
      status: 400,
      error: "You already play this role on this set",
    };
  }
  return { ok: true };
}
