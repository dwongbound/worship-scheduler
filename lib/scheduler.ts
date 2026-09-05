// The auto-scheduling algorithm. Deliberately pure: no prisma, no next.js —
// plain data in, plain data out — so it's trivially unit-testable with
// vitest (see tests/unit/scheduler.test.ts).
//
// Strategy: greedy fill with load balancing and spacing.
//   1. Walk sets chronologically.
//   2. For each role slot (in the team's own catalog order, scarce first), pick the
//      candidate who (a) plays that instrument, (b) is available, (c) isn't
//      already on this set, then prefer (d) people who did NOT serve within
//      the past week (soft — see SPACING below), and among those (e) whoever
//      has the FEWEST assignments so far, and among THOSE (f) whoever has done
//      the fewest sets FOR THIS TEAM (see PER-TEAM BALANCE).
//   3. Ties break on user id so results are deterministic (nice for tests).
// Slots with no viable candidate stay empty rather than blocking the run.
//
// ACOUSTIC GUITAR is a special case: it's filled LAST (after worship leader and
// vocals are seated) and only by someone already holding one of those roles who
// also plays acoustic — the acoustic guitarist should double as the leader/a
// singer. If none of them play it, the slot is left empty (never a dedicated
// acoustic-only player). See ACOUSTIC_HOST_ROLES.
//
// PER-TEAM BALANCE: overall load alone can seat someone on all four of one
// team's sets and none of another's — both teams' sets are just "a set" to a
// global tally, so which team a slot belongs to never enters the choice. A
// per-(user, team) tally breaks ties that user id used to break arbitrarily,
// steering each pick toward whoever has served THIS team least. It sits BELOW
// the global count on purpose: it re-orders only people who are already
// equally loaded, so it can never make overall balance worse by handing a set
// to someone who's already stretched across three teams.
//
// MUSICAL DIRECTOR: a required-MD set is filled on pure rotation FIRST, and
// only if that roster contains nobody who could lead (lib/md.ts's rule) is it
// thrown away and refilled with a seat reserved for an MD. Reserving up front —
// which is what this used to do, one role at a time, taking the first role that
// had any MD free — handed the same person every set as soon as they were the
// only MD in some role. When a seat IS reserved, WHO gets it is the freshest MD
// by the same rotation ranking as everyone else, and their ROLE is the most
// preferred one they can take: electric guitar, then keys, then bass (MD_ROLES
// is preference-ordered).
//
// SPACING: someone who served (or is being scheduled) within MIN_GAP_DAYS of
// a set is deprioritized for it, not excluded — with enough people this makes
// weekly sets rotate round-robin, but a small pool still gets fully staffed.
// Callers can feed `existingAssignments` (already-booked set dates from the
// DB) so one-off sets also avoid people who just served nearby.

import {
  ACOUSTIC_HOST_ROLES,
  MD_ROLES,
  rolesMayOverlap,
  type BandRole,
  type Instrument,
  type SlotCapacityMap,
} from "./constants";
import {
  DEFAULT_TEAM_ROLES,
  slottedRoles,
  resolveTeamCapacities,
  teamSupportsMD,
  type TeamRoleDef,
} from "./teamRoles";
import { eligibleMDIds } from "./md";

export interface SchedulerUser {
  id: string;
  // True if this person can serve as a set's musical director.
  isMD?: boolean;
  // Roles this person can fill, PER TEAM (only teams they're on appear). The
  // scheduler consults the entry for the set's team; a team-less set uses the
  // union across all the person's teams (preserves "open to the whole org").
  rolesByTeam: Record<string, Instrument[]>;
}

// The roles a user may fill on a given set: their roles on the set's team, or —
// for a team-less set — the union of their roles across every team they're on.
function rolesFor(user: SchedulerUser, set: SchedulerSet): Instrument[] {
  return set.teamId
    ? user.rolesByTeam[set.teamId] ?? []
    : Object.values(user.rolesByTeam).flat();
}

export interface SchedulerSet {
  id: string;
  startsAt: Date;
  durationMinutes: number;
  // The team this set is for. When present, only users whose teamIds include
  // it are considered; null/omitted = open to everyone.
  teamId?: string | null;
  // The catalog of the set's team — which roles exist here, in what order they
  // fill (scarce-first), and how many of each the team wants by default.
  // Omitted → the built-in defaults, which is what a team-less set uses.
  roles?: TeamRoleDef[] | null;
  // The set's own shape, overriding its team's default counts role by role.
  capacities?: SlotCapacityMap | null;
  // When true, reserve one slot for an available MD before the normal fill.
  requiresMD?: boolean;
  // Slots already filled before this run (e.g. hand-picked by an admin).
  // They're hard constraints the fill works around: each consumes one slot of
  // its role, its person is never proposed again on this set, and an MD among
  // them (in an MD-capable role) satisfies requiresMD. Never re-proposed.
  // NOTE: their load is NOT added to the balancing tally here — fold it into
  // `existingCounts` if it should count (a db-wide count already includes it).
  preAssigned?: { userId: string; role: Instrument; isMD?: boolean }[];
}

// Mirrors the Unavailability prisma model (times the user CANNOT serve).
export interface UnavailabilityRule {
  userId: string;
  type: "RECURRING" | "SPECIFIC" | "DATE_RANGE";
  dayOfWeek?: number | null; // 0 = Sunday ... 6 = Saturday
  startMinute?: number | null; // minutes from midnight
  endMinute?: number | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface ProposedAssignment {
  setId: string;
  userId: string;
  role: Instrument;
}

// A date someone is already booked on (from the DB), for the spacing rule.
export interface ExistingAssignment {
  userId: string;
  startsAt: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Two bookings closer together than this are "too close": the person is
// deprioritized (never excluded). 8 days so exactly-a-week-apart recurring
// sets count as back-to-back weeks.
const MIN_GAP_DAYS = 8;

// Midnight of the given date's calendar day (drops the time component) so we
// can compare two dates by day regardless of their clock times.
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * True if no unavailability rule blocks this user from this set.
 * Recurring rules block when the day matches and the time windows overlap;
 * date-range rules block any set starting within the range (inclusive).
 */
export function isUserAvailable(
  userId: string,
  set: SchedulerSet,
  rules: UnavailabilityRule[]
): boolean {
  for (const rule of rules) {
    if (rule.userId !== userId) continue;

    if (rule.type === "RECURRING" || rule.type === "SPECIFIC") {
      // RECURRING applies on every matching weekday, up to its optional
      // endDate. SPECIFIC applies on its startDate, or across
      // [startDate, endDate] when an end date is set (a multi-day block).
      // Both then check time-window overlap.
      if (rule.type === "RECURRING") {
        if (set.startsAt.getDay() !== rule.dayOfWeek) continue;
        // A recurring block can stop repeating: `endDate` is the last day it
        // applies (null = forever).
        if (rule.endDate && startOfDay(set.startsAt) > startOfDay(rule.endDate)) {
          continue;
        }
      } else {
        if (!rule.startDate) continue;
        // Compare by calendar day so a set anywhere within the day-range is
        // blocked (endDate defaults to startDate → a single day).
        const setDay = startOfDay(set.startsAt);
        const startDay = startOfDay(rule.startDate);
        const endDay = rule.endDate ? startOfDay(rule.endDate) : startDay;
        if (setDay < startDay || setDay > endDay) continue;
      }
      const setStart = set.startsAt.getHours() * 60 + set.startsAt.getMinutes();
      const setEnd = setStart + set.durationMinutes;
      const ruleStart = rule.startMinute ?? 0;
      const ruleEnd = rule.endMinute ?? 24 * 60;
      // Standard half-open interval overlap check.
      if (setStart < ruleEnd && setEnd > ruleStart) return false;
    } else {
      // DATE_RANGE — endDate is stored at midnight, so extend it to the
      // end of that day to make the range inclusive.
      const t = set.startsAt.getTime();
      const start = rule.startDate ? rule.startDate.getTime() : -Infinity;
      const end = rule.endDate
        ? rule.endDate.getTime() + MS_PER_DAY - 1
        : Infinity;
      if (t >= start && t <= end) return false;
    }
  }
  return true;
}

/**
 * Map key for one person's tally on one team. A team-less set ("open to the
 * whole org") gets its own bucket rather than being merged into any team's.
 */
export function teamKey(userId: string, teamId: string | null | undefined): string {
  return `${userId}|${teamId ?? ""}`;
}

/**
 * Fill every set's slots from the pool of users.
 * `existingCounts` lets callers pre-load how many assignments each user
 * already has (so re-runs stay balanced against prior schedules).
 * `existingAssignments` are dates people are already booked on in the DB, so
 * the spacing rule can also steer new sets away from them.
 * `existingTeamCounts` does the same per team, keyed by `teamKey(userId,
 * teamId)` — without it a re-run starts every team tally at zero while the
 * global one carries over, and the two signals disagree.
 */
export function buildSchedule(
  sets: SchedulerSet[],
  users: SchedulerUser[],
  rules: UnavailabilityRule[],
  existingCounts: Map<string, number> = new Map(),
  existingAssignments: ExistingAssignment[] = [],
  existingTeamCounts: Map<string, number> = new Map()
): ProposedAssignment[] {
  // Running tally of assignments per user — the load-balancing signal.
  const counts = new Map<string, number>();
  for (const u of users) counts.set(u.id, existingCounts.get(u.id) ?? 0);

  // The same tally split by team — see PER-TEAM BALANCE above. Seeded from the
  // caller's DB counts so a re-run continues where the last one left off.
  const teamCounts = new Map<string, number>(existingTeamCounts);
  const teamCountOf = (userId: string, teamId: string | null | undefined) =>
    teamCounts.get(teamKey(userId, teamId)) ?? 0;

  // Every date each person is booked on (DB bookings + picks made during this
  // run) — the spacing signal. See tooClose below.
  const bookedTimes = new Map<string, number[]>();
  for (const a of existingAssignments) {
    const times = bookedTimes.get(a.userId) ?? [];
    times.push(a.startsAt.getTime());
    bookedTimes.set(a.userId, times);
  }
  const recordBooking = (userId: string, time: number) => {
    const times = bookedTimes.get(userId) ?? [];
    times.push(time);
    bookedTimes.set(userId, times);
  };
  // True when the person already has a booking within MIN_GAP_DAYS of `time`
  // (either side) — they served too recently, or are about to serve again.
  const tooClose = (userId: string, time: number): boolean => {
    const times = bookedTimes.get(userId);
    if (!times) return false;
    return times.some(
      (t) => t !== time && Math.abs(t - time) < MIN_GAP_DAYS * MS_PER_DAY
    );
  };

  // Who's an MD, for checking a filled roster against lib/md.ts's rule.
  const isMDById = new Map(users.map((u) => [u.id, !!u.isMD]));

  const proposals: ProposedAssignment[] = [];
  const chronological = [...sets].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  for (const set of chronological) {
    const setTime = set.startsAt.getTime();
    // Every pre-assigned seat is a fill constraint, choir included. (Choir was
    // dropped here while it was an unbounded list — seating every available
    // singer would otherwise have blocked them all from their band roles. Now
    // that a choir seat is deliberate and counted, standing in one means you
    // aren't also playing bass, which is what the rest of the fill assumes.)
    const preAssigned = set.preAssigned ?? [];
    // Roles each person already holds on this set — seeded with the pre-assigned
    // people. Normally one slot per person, but one person may hold BOTH worship
    // leader and acoustic guitar (OVERLAP_ALLOWED_ROLES); see canTakeRole.
    const rolesOnSet = new Map<string, Set<Instrument>>();
    for (const p of preAssigned) {
      const held = rolesOnSet.get(p.userId) ?? new Set<Instrument>();
      held.add(p.role);
      rolesOnSet.set(p.userId, held);
      // Their presence here counts for spacing on the surrounding sets too —
      // and toward this team's tally, so a hand-picked roster steers the rest
      // of the run the same way an auto-filled one does. (Deliberately NOT the
      // global tally; see the note on `preAssigned`.)
      recordBooking(p.userId, setTime);
      const preKey = teamKey(p.userId, set.teamId);
      teamCounts.set(preKey, (teamCounts.get(preKey) ?? 0) + 1);
    }
    // This set's role catalog and its resulting shape. Both come from the
    // team now, so two teams can fill genuinely different rosters.
    const catalog = set.roles?.length ? set.roles : DEFAULT_TEAM_ROLES;
    const fillOrder = slottedRoles(catalog);
    // Remaining slots per role — starts at the set's shape, decremented as we
    // fill (and restored by undoPicks when a fill is thrown away).
    const remaining = resolveTeamCapacities(catalog, set.capacities);
    // Pre-assigned slots are already taken (an overfilled role just goes
    // negative, which the fill loop treats as full).
    // A pre-assigned slot in a role the team has since dropped isn't in the
    // shape at all; `?? 0` keeps it from writing a stray NaN key.
    for (const p of preAssigned) remaining[p.role] = (remaining[p.role] ?? 0) - 1;

    // Whether `userId` may additionally take `role`. Enforces one role per
    // person, minus the sanctioned overlaps: the new role must be allowed to
    // pair with EVERY role they already hold (see rolesMayOverlap).
    const canTakeRole = (userId: string, role: Instrument): boolean => {
      const held = rolesOnSet.get(userId);
      if (!held || held.size === 0) return true; // no role yet
      if (held.has(role)) return false; // already in this exact role
      for (const r of held) if (!rolesMayOverlap(r, role)) return false;
      return true;
    };

    // Picks made for THIS set, in order. They only reach `proposals` once the
    // set is settled, so the required-MD retry below can throw them away.
    const picks: ProposedAssignment[] = [];

    // Commit a pick: record it and update all running tallies.
    const assign = (userId: string, role: BandRole) => {
      const held = rolesOnSet.get(userId) ?? new Set<Instrument>();
      held.add(role);
      rolesOnSet.set(userId, held);
      counts.set(userId, (counts.get(userId) ?? 0) + 1);
      const tk = teamKey(userId, set.teamId);
      teamCounts.set(tk, (teamCounts.get(tk) ?? 0) + 1);
      recordBooking(userId, setTime);
      remaining[role]--;
      picks.push({ setId: set.id, userId, role });
    };

    // Undo every pick this set has made, reversing exactly what `assign` did so
    // the set can be re-filled from scratch. Pre-assigned seats are untouched —
    // they're constraints, not picks. Used only by the required-MD retry.
    const undoPicks = () => {
      for (const p of picks.reverse()) {
        rolesOnSet.get(p.userId)?.delete(p.role);
        counts.set(p.userId, (counts.get(p.userId) ?? 1) - 1);
        const tk = teamKey(p.userId, set.teamId);
        teamCounts.set(tk, (teamCounts.get(tk) ?? 1) - 1);
        // Drop ONE booking at this set's time: the person may legitimately
        // still have another here (a pre-assigned seat, or an overlapping role).
        const times = bookedTimes.get(p.userId);
        const at = times ? times.indexOf(setTime) : -1;
        if (times && at >= 0) times.splice(at, 1);
        remaining[p.role]++;
      }
      picks.length = 0;
    };

    // The rotation ranking EVERY pick is made with — the MD pass included, so
    // nobody gets a seat by a route that skips load balancing. Preference
    // order: people NOT booked within MIN_GAP_DAYS of this set first (the
    // spacing rule — soft, so a small pool still fills every slot), then the
    // least-loaded overall, then the least-loaded on this team, then user id
    // for determinism.
    const byRotation = (a: SchedulerUser, b: SchedulerUser) =>
      Number(tooClose(a.id, setTime)) - Number(tooClose(b.id, setTime)) ||
      counts.get(a.id)! - counts.get(b.id)! ||
      teamCountOf(a.id, set.teamId) - teamCountOf(b.id, set.teamId) ||
      a.id.localeCompare(b.id);

    // Pick the best candidate for a role, honoring availability and the
    // one-slot-per-person rule (plus its lone overlap exception). MDs are
    // ordinary players here — they may fill any role on any set; being the
    // set's designated MD is a separate choice (Set.mdUserId, see lib/md.ts).
    const bestFor = (
      role: Instrument,
      // Extra hard filter on candidates (e.g. "already seated as WL/vocals" for
      // the acoustic pass below). Defaults to no restriction.
      eligible: (u: SchedulerUser) => boolean = () => true
    ) =>
      users
        // Eligible = plays this role on the set's team (team-restricted set), or
        // on any team for a team-less set. A person on the team with no roles
        // for it is naturally excluded — rolesFor returns [].
        .filter((u) => rolesFor(u, set).includes(role))
        .filter((u) => eligible(u))
        .filter((u) => canTakeRole(u.id, role))
        .filter((u) => isUserAvailable(u.id, set, rules))
        .sort(byRotation)[0];

    // ── MD reservation (retry only — see the fill/retry block below) ─────
    // Seat an MD ahead of everyone else. WHO comes first: the MD pool is ranked
    // by the same rotation as every other pick, so the seat moves around the
    // MDs instead of pinning itself to whichever one happens to play a role
    // nobody else covers. Their ROLE is then the most preferred one they can
    // actually take — electric guitar, then keys, then bass (MD_ROLES is
    // preference-ordered; the MD is normally the electric guitarist).
    // If nobody qualifies the set is left unled — surfaced to the admin rather
    // than blocking the run.
    const seatMD = () => {
      // The MD-capable slots this team has AND still has room in.
      const openMDRoles = MD_ROLES.filter(
        (r) => catalog.some((c) => c.key === r) && (remaining[r] ?? 0) > 0
      );
      const best = users
        .filter((u) => u.isMD)
        .filter((u) => isUserAvailable(u.id, set, rules))
        .map((u) => ({
          user: u,
          // Their most preferred open MD role, or undefined if they play none.
          role: openMDRoles.find(
            (r) => rolesFor(u, set).includes(r) && canTakeRole(u.id, r)
          ),
        }))
        .filter((c): c is { user: SchedulerUser; role: Instrument } => !!c.role)
        .sort((a, b) => byRotation(a.user, b.user))[0];
      if (best) assign(best.user.id, best.role);
    };

    // One complete fill of this set's open slots. `reserveMD` seats an MD
    // first, which bends the rotation, so only the retry below passes it.
    const fillSet = (reserveMD: boolean) => {
      if (reserveMD) seatMD();

      // ── Normal greedy fill of the remaining slots ─────────────────────
      // Every slotted role is capacity-filled here, choir included.
      // ACOUSTIC_GUITAR is skipped here and filled in its own pass afterward,
      // because its candidate must ALREADY be seated as the worship leader or a
      // vocalist (which VOCALS, filled last in ROLE_ORDER, only becomes after).
      for (const { key: role } of fillOrder) {
        if (role === "ACOUSTIC_GUITAR") continue;
        while (remaining[role] > 0) {
          const pick = bestFor(role);
          if (!pick) break; // nobody left for this role — leave slot empty
          assign(pick.id, role);
        }
      }

      // ── Acoustic guitar: only a seated worship leader or vocalist ──────
      // The acoustic guitarist should also be singing/leading — never a
      // dedicated acoustic-only player. Now that every other role is seated,
      // hand the slot to a worship leader or vocalist on this set who also
      // plays acoustic (canTakeRole already sanctions that double-up). If none
      // do, leave it empty. Only fires if this team kept the built-in acoustic
      // role — the double-up rule is built-in behaviour a custom role never
      // inherits.
      const holdsHostRole = (userId: string): boolean => {
        const held = rolesOnSet.get(userId);
        return held ? ACOUSTIC_HOST_ROLES.some((r) => held.has(r)) : false;
      };
      while ((remaining.ACOUSTIC_GUITAR ?? 0) > 0) {
        const pick = bestFor("ACOUSTIC_GUITAR", (u) => holdsHostRole(u.id));
        if (!pick) break; // no seated WL/vocalist plays acoustic — leave empty
        assign(pick.id, "ACOUSTIC_GUITAR");
      }
    };

    // Can the roster as filled supply an MD? Same rule the app designates one
    // with (lib/md.ts): an MD in an MD-capable role who isn't the worship
    // leader. Pre-assigned seats count — a hand-picked MD needs no reservation.
    const rosterCanLead = () =>
      eligibleMDIds([
        ...preAssigned,
        ...picks.map((p) => ({
          userId: p.userId,
          role: p.role,
          isMD: isMDById.get(p.userId) ?? false,
        })),
      ]).length > 0;

    // ── Fill, then only reserve an MD if the fill didn't produce one ─────
    // Rotation comes first. Reserving the MD up front (which is what this used
    // to do) hands the same person every single set as soon as they're the only
    // MD in some role — the reservation looked at one role at a time and took
    // the first that had any MD free, so load and spacing never entered into
    // it. So: fill on pure rotation, and only if that roster turns out to have
    // nobody who could lead do we throw it away and refill with a seat held for
    // an MD. A team that has deleted MD from its catalog has no MD logic at
    // all, so requiresMD on one of its sets is a leftover flag we ignore.
    fillSet(false);
    if (set.requiresMD && teamSupportsMD(catalog) && !rosterCanLead()) {
      undoPicks();
      fillSet(true);
    }
    proposals.push(...picks);
  }

  return proposals;
}

/**
 * Who "Auto schedule" should seat in ONE guest-team role — the generalization
 * of what the hardcoded choir fill used to do.
 *
 * Everyone on `guestTeamId` who plays `role` there and is free at the set's
 * time, minus `alreadyOnSet`. That subtraction is the point: a guest seat is
 * meant for someone who ISN'T otherwise busy on this set, so a singer already
 * playing keys on the band isn't also dragged into the visiting choir.
 *
 * Ordered least-recently-booked first (via `bookings`) so a CAPPED guest role
 * rotates like any other; an `allAvailable` role ignores the cap and seats the
 * whole list. Pure + separate from buildSchedule so the set detail modal's
 * "Auto schedule" can layer guests on top of a normal band fill.
 */
export function availableGuestMembers(
  set: SchedulerSet,
  role: Instrument,
  guestTeamId: string,
  users: SchedulerUser[],
  rules: UnavailabilityRule[],
  alreadyOnSet: Set<string> = new Set(),
  // How many times each person is already booked nearby — same map the band
  // fill uses. Absent = everyone ties and the order falls back to name/id.
  loads: Map<string, number> = new Map()
): string[] {
  return users
    .filter((u) => (u.rolesByTeam[guestTeamId] ?? []).includes(role))
    .filter((u) => !alreadyOnSet.has(u.id))
    .filter((u) => isUserAvailable(u.id, set, rules))
    .sort(
      (a, b) => (loads.get(a.id) ?? 0) - (loads.get(b.id) ?? 0) || a.id.localeCompare(b.id)
    )
    .map((u) => u.id);
}
