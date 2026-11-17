// Pure set-related logic, kept out of the route/component bodies so it can be
// unit-tested directly (see tests/unit/sets.test.ts). Four rules live here:
//   1. selectUpcomingSets — what the calendar's "Upcoming sets" drawer shows.
//   2. canViewSet         — who may see a private set.
//   3. coverEligibility   — who may take a swap-requested slot as a cover.
//   4. resolveSetsWindow  — the date range GET /api/sets reads.
//   5. seatIndex/rolesHeldOn — who already holds which roles on which set,
//      which is how the swap picker spots a trade that would double-book
//      someone.
import {
  SETS_WINDOW_DEFAULT_DAYS,
  SETS_WINDOW_MAX_DAYS,
  type Instrument,
} from "./constants";
import { parseLocalDate } from "./dates";
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
// A private set is visible only to admins of its org and the people assigned
// to it; a normal (public) set is visible to anyone in its org. `isOrgAdmin`
// means "admin over THIS set's org" — callers get it from requireOrgAdminFor,
// which already counts platform super-admins as admins everywhere.
export function canViewSet(
  set: { isPrivate: boolean; assignedUserIds: string[] },
  viewer: { userId: string; isOrgAdmin: boolean }
): boolean {
  if (!set.isPrivate) return true;
  return viewer.isOrgAdmin || set.assignedUserIds.includes(viewer.userId);
}

// The same rule as a Prisma `where` fragment, for the endpoints that list many
// sets at once (GET /api/sets, POST /api/export/schedule). Spread it into the
// where alongside the org/date scoping.
//
// Super-admins are admins of every org — including ones they never joined, or
// joined as a plain member — so the membership OR branch alone would hide a
// private set from them (e.g. one they just created and hadn't staffed yet).
// They're already trusted with every org's data elsewhere, so they skip the
// filter entirely and see every set inside whatever org scope they asked for.
export function visibleSetsFilter(viewer: {
  userId: string;
  isSuperAdmin: boolean;
}) {
  if (viewer.isSuperAdmin) return {};
  return {
    OR: [
      { isPrivate: false },
      { assignments: { some: { userId: viewer.userId } } },
      { org: { memberships: { some: { userId: viewer.userId, isAdmin: true } } } },
    ],
  };
}

// ── 3. Swap-cover eligibility ────────────────────────────────────────────
export interface CoverEligibilityInput {
  viewerId: string;
  ownerId: string; // who currently holds the swap-requested slot
  assignmentStatus: string; // must be "SWAP_REQUESTED" to be takeable
  // Roles the viewer can play FOR THIS SET — their roles on the set's team, or
  // (for a team-less set) the union across all their teams. Roles are per-team.
  viewerRolesForSet: Instrument[];
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
  if (!i.viewerRolesForSet.includes(i.role)) {
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

// ── 5. Who already sits where ────────────────────────────────────────────
// A person can legitimately hold several roles on one set (worship leader +
// acoustic guitar), so a seat they already have never BLOCKS a trade — but it
// does change what the trade means, and the swap picker has to be able to say
// so. Two cases, both invisible without this:
//   • the counterparty is already on MY set in another role — accepting would
//     leave them playing two roles that morning;
//   • I'm already on THEIR set in another role — same, for me.
// (The same ROLE on both sides is impossible: GET /api/swaps/candidates drops
// those sets outright, since the trade would collide with the
// setId+userId+role unique key.)

/** One person's seat on one set — the three columns the lookups below need. */
export interface Seat {
  setId: string;
  userId: string;
  role: string;
}

/**
 * Seats indexed for "which roles does this person hold on this set?".
 *
 * Built once per request rather than scanning the list per candidate: the
 * picker asks the same question for every row on the page, against the same
 * two seat lists.
 */
export type SeatIndex = Map<string, string[]>;

const seatKey = (setId: string, userId: string) => `${setId}|${userId}`;

export function seatIndex(seats: Seat[]): SeatIndex {
  const index: SeatIndex = new Map();
  for (const seat of seats) {
    const key = seatKey(seat.setId, seat.userId);
    const roles = index.get(key);
    if (roles) roles.push(seat.role);
    else index.set(key, [seat.role]);
  }
  return index;
}

/**
 * The roles `userId` already holds on `setId` — empty when they hold none.
 * `except` drops the role being traded, so a seat is never reported as a
 * conflict with itself.
 */
export function rolesHeldOn(
  index: SeatIndex,
  setId: string,
  userId: string,
  except?: string
): string[] {
  const roles = index.get(seatKey(setId, userId)) ?? [];
  return except === undefined ? [...roles] : roles.filter((r) => r !== except);
}

// ── 4. The GET /api/sets date window ─────────────────────────────────────
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Turn the optional `?from=`/`?to=` params (YYYY-MM-DD) into the range the
 * query reads.
 *
 * Each side falls back to today ± SETS_WINDOW_DEFAULT_DAYS independently, so a
 * caller that passes nothing (the e2e suite, any older client) gets exactly the
 * window the endpoint always had. `from` snaps to the start of its day and `to`
 * to the end of its, so a whole-month range is inclusive at both edges.
 *
 * Dates are parsed with parseLocalDate — the app's single source of truth —
 * because `new Date("2026-09-01")` is UTC midnight, which in a negative-offset
 * TZ resolves to Aug 31 locally and would quietly drop a requested month's last
 * day. Anything unparseable falls back to that side's default.
 *
 * The span is clamped to SETS_WINDOW_MAX_DAYS: an over-wide range is truncated
 * from `start` rather than rejected, since that's a client bug and not
 * something worth failing the calendar over.
 */
export function resolveSetsWindow(
  from: string | null,
  to: string | null,
  now: Date = new Date()
): { start: Date; end: Date } {
  const nowMs = now.getTime();
  const fromDate = parseLocalDate(from);
  const toDate = parseLocalDate(to);

  const start =
    fromDate ?? new Date(nowMs - SETS_WINDOW_DEFAULT_DAYS * MS_PER_DAY);
  // parseLocalDate gives midnight; push `to` to the end of that day so the
  // range covers it.
  let end = toDate
    ? new Date(toDate.getTime() + MS_PER_DAY - 1)
    : new Date(nowMs + SETS_WINDOW_DEFAULT_DAYS * MS_PER_DAY);

  // A backwards range would return nothing at all; treat it as the default span
  // forward from `start` so a swapped pair still shows something sensible.
  if (end.getTime() < start.getTime()) {
    end = new Date(start.getTime() + SETS_WINDOW_DEFAULT_DAYS * MS_PER_DAY);
  }
  const maxEnd = start.getTime() + SETS_WINDOW_MAX_DAYS * MS_PER_DAY;
  if (end.getTime() > maxEnd) end = new Date(maxEnd);

  return { start, end };
}

/**
 * Fold a freshly fetched span of sets into the ones already on screen.
 *
 * The calendar widens its window as you page forward, and only asks for the
 * DAYS IT DOESN'T HAVE — so what comes back has to be merged rather than swapped
 * in. Two rules, and they're the whole function:
 *
 *   • an id present in both wins from `incoming`, because that's the fresher
 *     read (a gap fetch can overlap a day already held, and the newer roster is
 *     the one to keep);
 *   • the result is ordered by start time, since callers walk it in order and a
 *     gap arriving from the past would otherwise land at the end.
 *
 * Pure, so the merge can be reasoned about without a calendar attached.
 */
export function mergeSetWindows<T extends { id: string; startsAt: string }>(
  existing: T[],
  incoming: T[]
): T[] {
  const byId = new Map(existing.map((set) => [set.id, set]));
  for (const set of incoming) byId.set(set.id, set);
  return [...byId.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** A half-open span of time, in epoch ms. */
export interface MsRange {
  start: number;
  end: number;
}

/**
 * Which parts of `wanted` aren't covered by `loaded` yet — the days a widened
 * calendar window actually has to ask the server for.
 *
 * The calendar's window only ever grows outward from what's on screen, so this
 * is at most two spans: one off each end. A `loaded` of null means nothing has
 * been fetched, and the whole of `wanted` is missing.
 *
 * Deliberately NOT a general interval-difference: the two windows always
 * overlap or touch in practice (the new one contains the old), and pretending
 * otherwise would invite a "gap" the size of a decade if they ever didn't —
 * so a wanted range that misses `loaded` entirely is returned whole, which is
 * the honest answer for "what do I not have".
 */
export function missingRanges(
  loaded: MsRange | null,
  wanted: MsRange
): MsRange[] {
  if (!loaded) return [wanted];
  // No overlap at all: nothing of `wanted` is held, so all of it is missing.
  if (wanted.end <= loaded.start || wanted.start >= loaded.end) return [wanted];

  const gaps: MsRange[] = [];
  if (wanted.start < loaded.start) {
    gaps.push({ start: wanted.start, end: loaded.start });
  }
  if (wanted.end > loaded.end) gaps.push({ start: loaded.end, end: wanted.end });
  return gaps;
}

/** The span covering both — what's held once a gap fetch lands. */
export function unionRange(a: MsRange, b: MsRange): MsRange {
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}
