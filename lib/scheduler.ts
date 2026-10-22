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
// SHARED ROLES (SHARE_ROLES rules): one person holds one role per set, except
// where a rule lets whoever plays one of `withRoles` also play `role`. A shared
// role is filled LAST, once its hosts are seated. Required: only a seated host
// who plays it may take it, and if none do the slot is left empty (never a
// dedicated player) — the built-in "the acoustic guitarist doubles as the
// worship leader or a vocalist", which every org starts with as a rule. A
// preference hands it to a seated host first and falls back to anyone.
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
// preferred one they can take, in the org's MD order for the set's team
// (mdRolesFor — electric guitar, then keys, then bass unless an admin says
// otherwise).
//
// SPACING: someone who served (or is being scheduled) within MIN_GAP_DAYS of
// a set is deprioritized for it, not excluded — with enough people this makes
// weekly sets rotate round-robin, but a small pool still gets fully staffed.
// Callers can feed `existingAssignments` (already-booked set dates from the
// DB) so one-off sets also avoid people who just served nearby.
//
// SCHEDULING RULES (lib/schedulingRules.ts) — the org's own instructions,
// passed as `options.schedulingRules`:
//   • REQUIRED rules are hard filters, applied with availability: a candidate
//     who'd break one (a NEVER partner already seated, over a LIMIT, an ALWAYS
//     partner who couldn't be seated alongside) isn't a candidate at all. A
//     required SAME_PLAYER rule reserves the slot for the partner set's player;
//     if they can't take it, the slot is left OPEN rather than given to someone
//     else, and required PREFER puts A ahead of B however rotation ranks them.
//   • PREFERENCES rank candidates ABOVE rotation, in their list order: each one
//     scores a candidate better / neutral / worse for this pick, and the first
//     preference that tells two candidates apart decides between them. Only
//     when every preference is neutral does rotation (spacing, load, per-team
//     load) decide, so with no rules the fill is exactly what it always was.
//   • An ALWAYS pair is seated together: right after one of them is placed,
//     the other is put in the first open role they play (fill order).
//   • A rule scoped to a team governs only that team's sets (a team-less set
//     follows the all-teams rules alone), and a team's LIMIT counts only that
//     team's sets.
//   • `schedulingRules` left undefined means "no list was given": the fill
//     follows DEFAULT_RULES, the behaviour every org starts with. An explicit
//     list — even an empty one — is the whole truth.

import {
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
import { APP_TZ } from "./appTz";
import { zonedParts } from "./dates";
import {
  DEFAULT_RULES,
  mdRolesFor,
  periodKey,
  ruleAppliesTo,
  weekKey,
  type RuleParams,
  type RulePeriod,
  type SchedulingRule,
} from "./schedulingRules";

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
  // Which recurring set this is an occurrence of — how a weekly SAME_PLAYER
  // rule finds its pair. Null/omitted = a one-off.
  templateId?: string | null;
  // The set's database id, when it has one — how a one-off SAME_PLAYER rule
  // (two specific sets) finds it. `id` above is only the run's own key.
  setId?: string | null;
}

// A set OUTSIDE this run whose roster a SAME_PLAYER rule may need — last
// Saturday's guitarist, when only Sunday is being filled.
export interface FixedSet {
  setId?: string | null;
  templateId?: string | null;
  startsAt: Date;
  assignments: { userId: string; role: string }[];
}

export interface ScheduleOptions {
  schedulingRules?: SchedulingRule[];
  fixedSets?: FixedSet[];
  // Extra bookings that only the LIMIT rules count (a month's worth, say),
  // for callers whose `existingAssignments` only covers the spacing window.
  periodBookings?: ExistingAssignment[];
  timeZone?: string;
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
// `teamId` (the booked set's team) is only read by a team's LIMIT rules.
export interface ExistingAssignment {
  userId: string;
  startsAt: Date;
  teamId?: string | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// What the fill's candidate search returns for a slot a required SAME_PLAYER
// rule reserves for someone who can't take it: leave it open.
const HOLD = "hold" as const;

// Two bookings closer together than this are "too close": the person is
// deprioritized (never excluded). 8 days so exactly-a-week-apart recurring
// sets count as back-to-back weeks.
const MIN_GAP_DAYS = 8;

/**
 * True if no unavailability rule blocks this user from this set.
 * Recurring rules block when the day matches and the time windows overlap;
 * date-range rules block any set starting within the range (inclusive).
 *
 * EVERY comparison here is made on the APP'S wall clock, not the runtime's.
 * A rule says "Saturdays, 6am–12pm" — a weekday and minutes from midnight,
 * which only mean something in one zone. Reading the set's day and hour with
 * `getDay()`/`getHours()` answered in whatever zone the CODE was running in,
 * so the server (church time) and an admin's browser (theirs) could disagree
 * about which day a set was even on: the scheduler would seat someone the
 * review modal then flagged as unavailable, on the same data.
 */
export function isUserAvailable(
  userId: string,
  set: SchedulerSet,
  rules: UnavailabilityRule[],
  timeZone: string = APP_TZ
): boolean {
  const when = zonedParts(set.startsAt, timeZone);
  // A rule's dates are stored as instants; what matters is the calendar day
  // they land on in the app's zone.
  const ruleDay = (d: Date) => zonedParts(d, timeZone).ymd;

  for (const rule of rules) {
    if (rule.userId !== userId) continue;

    if (rule.type === "RECURRING" || rule.type === "SPECIFIC") {
      // RECURRING applies on every matching weekday, inside its optional
      // [startDate, endDate] span. SPECIFIC applies on its startDate, or across
      // [startDate, endDate] when an end date is set (a multi-day block).
      // Both then check time-window overlap.
      if (rule.type === "RECURRING") {
        if (when.weekday !== rule.dayOfWeek) continue;
        // A recurring block can repeat over a limited span: `startDate` is the
        // first day it applies and `endDate` the last (null on either end =
        // open-ended that way, so both null = forever).
        if (rule.startDate && when.ymd < ruleDay(rule.startDate)) continue;
        if (rule.endDate && when.ymd > ruleDay(rule.endDate)) continue;
      } else {
        if (!rule.startDate) continue;
        // Compare by calendar day so a set anywhere within the day-range is
        // blocked (endDate defaults to startDate → a single day).
        const startDay = ruleDay(rule.startDate);
        const endDay = rule.endDate ? ruleDay(rule.endDate) : startDay;
        if (when.ymd < startDay || when.ymd > endDay) continue;
      }
      const setStart = when.minuteOfDay;
      const setEnd = setStart + set.durationMinutes;
      const ruleStart = rule.startMinute ?? 0;
      const ruleEnd = rule.endMinute ?? 24 * 60;
      // Standard half-open interval overlap check.
      if (setStart < ruleEnd && setEnd > ruleStart) return false;
    } else {
      // DATE_RANGE — an inclusive span of calendar days, so it's the same
      // day comparison rather than instant math with an end-of-day fudge.
      const startDay = rule.startDate ? ruleDay(rule.startDate) : -Infinity;
      const endDay = rule.endDate ? ruleDay(rule.endDate) : Infinity;
      if (when.ymd >= startDay && when.ymd <= endDay) return false;
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
  existingTeamCounts: Map<string, number> = new Map(),
  options: ScheduleOptions = {}
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
  const userById = new Map(users.map((u) => [u.id, u]));

  // ── Scheduling rules — see SCHEDULING RULES above ──────────────────────
  const tz = options.timeZone ?? APP_TZ;
  const allRules: SchedulingRule[] =
    options.schedulingRules ?? DEFAULT_RULES.map((r, i) => ({ ...r, id: `default-${i}` }));
  const enabledRules = allRules.filter((r) => r.enabled);
  // userId → the people a TOGETHER rule of this tier and mode pairs them with.
  const togetherMap = (list: SchedulingRule[], mode: "ALWAYS" | "NEVER") => {
    const map = new Map<string, string[]>();
    for (const { params: p } of list) {
      if (p.kind !== "TOGETHER" || p.mode !== mode) continue;
      const [a, b] = p.userIds;
      map.set(a, [...(map.get(a) ?? []), b]);
      map.set(b, [...(map.get(b) ?? []), a]);
    }
    return map;
  };
  // Everything the fill reads from the rules, for the sets of one team (team
  // scope — see SCHEDULING RULES above). Built once per team per run.
  const scopeCache = new Map<string, ReturnType<typeof scopeOf>>();
  const scopeOf = (teamId: string | null) => {
    const activeRules = enabledRules.filter((r) => ruleAppliesTo(r, teamId));
    const required = activeRules.filter((r) => r.tier === "REQUIRED");
    const preferences = activeRules.filter((r) => r.tier === "PREFERENCE");
    const shares = activeRules.flatMap((r) =>
      r.params.kind === "SHARE_ROLES" ? [{ tier: r.tier, ...r.params }] : []
    );
    // Unordered pairs one person may hold together on a set.
    const sharedPairs = new Set(
      shares.flatMap((r) => r.withRoles.flatMap((w) => [`${r.role}|${w}`, `${w}|${r.role}`]))
    );
    // A shared role → the roles whose holders may double into it, and whether
    // ONLY they may (any required rule for it makes it host-only).
    const sharedRoles = new Map<string, { hosts: Set<string>; requiredHosts: Set<string> }>();
    for (const r of shares) {
      const e = sharedRoles.get(r.role) ?? { hosts: new Set(), requiredHosts: new Set() };
      for (const w of r.withRoles) {
        e.hosts.add(w);
        if (r.tier === "REQUIRED") e.requiredHosts.add(w);
      }
      sharedRoles.set(r.role, e);
    }
    return {
      activeRules,
      required,
      preferences,
      neverRequired: togetherMap(required, "NEVER"),
      alwaysRequired: togetherMap(required, "ALWAYS"),
      alwaysPreferred: togetherMap(preferences, "ALWAYS"),
      requiredLimits: required.flatMap((r) =>
        r.params.kind === "LIMIT" ? [{ ...r.params, teamId: r.teamId ?? null }] : []
      ),
      requiredPrefers: required.flatMap((r) => (r.params.kind === "PREFER" ? [r.params] : [])),
      sharedPairs,
      sharedRoles,
      mdRoles: mdRolesFor(allRules, teamId),
    };
  };
  const rulesForTeam = (teamId: string | null) => {
    const k = teamId ?? "";
    let v = scopeCache.get(k);
    if (!v) {
      v = scopeOf(teamId);
      scopeCache.set(k, v);
    }
    return v;
  };

  // LIMIT counting: distinct set times someone is booked on within a week or
  // month — this run's picks and DB bookings (bookedTimes), plus whatever the
  // caller fed in purely for the limits.
  const extraTimes = new Map<string, number[]>();
  for (const a of options.periodBookings ?? []) {
    extraTimes.set(a.userId, [...(extraTimes.get(a.userId) ?? []), a.startsAt.getTime()]);
  }
  // The same bookings by team (teamKey), for a team's own LIMIT: only the
  // team's sets count toward it. Fed by the DB bookings that carry a team and
  // by every seat this run makes.
  const teamTimes = new Map<string, number[]>();
  const recordTeamTime = (userId: string, teamId: string | null | undefined, time: number) => {
    const k = teamKey(userId, teamId);
    teamTimes.set(k, [...(teamTimes.get(k) ?? []), time]);
  };
  for (const a of [...existingAssignments, ...(options.periodBookings ?? [])]) {
    if (a.teamId !== undefined) recordTeamTime(a.userId, a.teamId, a.startsAt.getTime());
  }
  const periodCache = new Map<string, number>();
  const pkey = (t: number, period: RulePeriod) => {
    const k = `${period}|${t}`;
    let v = periodCache.get(k);
    if (v === undefined) {
      v = periodKey(t, period, tz);
      periodCache.set(k, v);
    }
    return v;
  };
  // `teamId` set = only that team's sets (a team's own LIMIT).
  const setsInPeriod = (
    userId: string,
    time: number,
    period: RulePeriod,
    teamId: string | null = null
  ) => {
    const k = pkey(time, period);
    const seen = new Set<number>();
    const times = teamId
      ? teamTimes.get(teamKey(userId, teamId)) ?? []
      : [...(bookedTimes.get(userId) ?? []), ...(extraTimes.get(userId) ?? [])];
    for (const t of times) {
      if (t !== time && pkey(t, period) === k) seen.add(t);
    }
    return seen.size;
  };

  // SAME_PLAYER needs every roster the run can see: its own sets (pre-assigned
  // seats now, picks as they're made) and the caller's fixed sets around it.
  interface RosterSet {
    setId: string | null;
    templateId: string | null;
    week: number;
    roster: { userId: string; role: string }[];
  }
  const rosterSets: RosterSet[] = [];
  const runRoster = new Map<string, RosterSet>();
  const runSetIds = new Set<string>();
  for (const s of sets) {
    const rs: RosterSet = {
      setId: s.setId ?? null,
      templateId: s.templateId ?? null,
      week: weekKey(s.startsAt, tz),
      roster: (s.preAssigned ?? []).map((p) => ({ userId: p.userId, role: p.role })),
    };
    rosterSets.push(rs);
    runRoster.set(s.id, rs);
    if (s.setId) runSetIds.add(s.setId);
  }
  for (const f of options.fixedSets ?? []) {
    if (f.setId && runSetIds.has(f.setId)) continue; // the run's own copy wins
    rosterSets.push({
      setId: f.setId ?? null,
      templateId: f.templateId ?? null,
      week: weekKey(f.startsAt, tz),
      roster: f.assignments,
    });
  }
  // Who plays `role` on the sets a SAME_PLAYER rule pairs `set` with.
  const partnerHolders = (
    set: SchedulerSet,
    p: Extract<RuleParams, { kind: "SAME_PLAYER" }>,
    role: string
  ): string[] => {
    if (p.role !== role) return [];
    const self = runRoster.get(set.id);
    if (!self) return [];
    let partners: RosterSet[];
    if (p.scope === "WEEKLY") {
      const i = self.templateId ? p.templateIds.indexOf(self.templateId) : -1;
      if (i < 0) return [];
      const other = p.templateIds[1 - i];
      partners = rosterSets.filter(
        (r) => r !== self && r.templateId === other && r.week === self.week
      );
    } else {
      const i = self.setId ? p.setIds.indexOf(self.setId) : -1;
      if (i < 0) return [];
      const other = p.setIds[1 - i];
      partners = rosterSets.filter((r) => r !== self && r.setId === other);
    }
    return [
      ...new Set(
        partners.flatMap((r) => r.roster.filter((a) => a.role === role).map((a) => a.userId))
      ),
    ];
  };

  const proposals: ProposedAssignment[] = [];
  const chronological = [...sets].sort(
    (a, b) => a.startsAt.getTime() - b.startsAt.getTime()
  );

  for (const set of chronological) {
    const setTime = set.startsAt.getTime();
    const {
      activeRules,
      preferences,
      neverRequired,
      alwaysRequired,
      alwaysPreferred,
      requiredLimits,
      requiredPrefers,
      sharedPairs,
      sharedRoles,
      mdRoles,
    } = rulesForTeam(set.teamId ?? null);
    // Every pre-assigned seat is a fill constraint, choir included. (Choir was
    // dropped here while it was an unbounded list — seating every available
    // singer would otherwise have blocked them all from their band roles. Now
    // that a choir seat is deliberate and counted, standing in one means you
    // aren't also playing bass, which is what the rest of the fill assumes.)
    const preAssigned = set.preAssigned ?? [];
    // Roles each person already holds on this set — seeded with the pre-assigned
    // people. Normally one slot per person, but a SHARE_ROLES rule lets one
    // person hold two (worship leader + acoustic guitar); see canTakeRole.
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
      recordTeamTime(p.userId, set.teamId, setTime);
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
    // person, minus the pairs a SHARE_ROLES rule allows: the new role must be
    // allowed to pair with EVERY role they already hold — so worship leader +
    // acoustic and acoustic + vox don't add up to worship leader + vox.
    const canTakeRole = (userId: string, role: Instrument): boolean => {
      const held = rolesOnSet.get(userId);
      if (!held || held.size === 0) return true; // no role yet
      if (held.has(role)) return false; // already in this exact role
      for (const r of held) if (!sharedPairs.has(`${r}|${role}`)) return false;
      return true;
    };
    // Is `userId` seated here in one of `hosts`?
    const holdsOneOf = (userId: string, hosts: Set<string>): boolean => {
      const held = rolesOnSet.get(userId);
      if (!held) return false;
      for (const r of held) if (hosts.has(r)) return true;
      return false;
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
      recordTeamTime(userId, set.teamId, setTime);
      remaining[role]--;
      picks.push({ setId: set.id, userId, role });
      runRoster.get(set.id)?.roster.push({ userId, role });
    };

    // Undo this set's picks back to `mark` (all of them by default), reversing
    // exactly what `assign` did. Pre-assigned seats are untouched — they're
    // constraints, not picks. Used by the required-MD retry (everything) and by
    // a required-ALWAYS group that couldn't all be seated (just that group).
    const undoPicks = (mark = 0) => {
      while (picks.length > mark) {
        const p = picks.pop()!;
        rolesOnSet.get(p.userId)?.delete(p.role);
        counts.set(p.userId, (counts.get(p.userId) ?? 1) - 1);
        const tk = teamKey(p.userId, set.teamId);
        teamCounts.set(tk, (teamCounts.get(tk) ?? 1) - 1);
        // Drop ONE booking at this set's time: the person may legitimately
        // still have another here (a pre-assigned seat, or an overlapping role).
        for (const times of [bookedTimes.get(p.userId), teamTimes.get(teamKey(p.userId, set.teamId))]) {
          const at = times ? times.indexOf(setTime) : -1;
          if (times && at >= 0) times.splice(at, 1);
        }
        remaining[p.role]++;
        const roster = runRoster.get(set.id)?.roster;
        const seatAt = roster
          ? roster.findIndex((a) => a.userId === p.userId && a.role === p.role)
          : -1;
        if (roster && seatAt >= 0) roster.splice(seatAt, 1);
      }
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

    // ── Rule helpers for THIS set ───────────────────────────────────────
    const onSet = (userId: string) => (rolesOnSet.get(userId)?.size ?? 0) > 0;
    // Adding a role to someone already on this set adds no set to their tally.
    const overLimit = (
      userId: string,
      max: number,
      period: RulePeriod,
      teamId: string | null = null
    ) => !onSet(userId) && setsInPeriod(userId, setTime, period, teamId) >= max;

    // The first open role (fill order) `userId` could still take here — where
    // an ALWAYS partner gets seated. `takingRole` is about to lose a slot to
    // the person being placed, so it needs one to spare. A seat a required
    // SAME_PLAYER rule holds for someone else isn't theirs to walk into either.
    const openRoleFor = (userId: string, takingRole?: string) => {
      const user = userById.get(userId);
      if (!user) return undefined;
      const plays = rolesFor(user, set);
      return fillOrder
        .map((r) => r.key)
        .find((r) => {
          const free = (remaining[r] ?? 0) - (r === takingRole ? 1 : 0);
          if (free <= 0 || !plays.includes(r) || !canTakeRole(userId, r)) return false;
          // A host-only shared role isn't a seat someone walks into.
          if (sharedRoles.get(r)?.requiredHosts.size) return false;
          const held = owed(r, "REQUIRED");
          return held.length < free || held.includes(userId);
        });
    };

    // Every REQUIRED rule, as a yes/no on one candidate. `withPartners` also
    // asks that each ALWAYS partner be on the set or seatable beside them —
    // off when checking the partner themselves, so the check can't recurse.
    const passesRequired = (
      userId: string,
      role: string | undefined,
      withPartners: boolean
    ): boolean => {
      for (const other of neverRequired.get(userId) ?? []) if (onSet(other)) return false;
      for (const l of requiredLimits) {
        if (l.userId === userId && overLimit(userId, l.max, l.period, l.teamId)) return false;
      }
      if (withPartners) {
        for (const other of alwaysRequired.get(userId) ?? []) {
          if (onSet(other)) continue;
          if (
            !isUserAvailable(other, set, rules) ||
            !passesRequired(other, undefined, false) ||
            !openRoleFor(other, role)
          ) {
            return false;
          }
        }
      }
      return true;
    };

    // The partner sets' players this set still owes `role` to, under rules of
    // one tier — anyone already holding `role` here is paid.
    const owed = (role: string, tier: SchedulingRule["tier"]) => [
      ...new Set(
        activeRules
          .filter((r) => r.tier === tier && r.params.kind === "SAME_PLAYER")
          .flatMap((r) =>
            partnerHolders(set, r.params as Extract<RuleParams, { kind: "SAME_PLAYER" }>, role)
          )
          .filter((id) => !rolesOnSet.get(id)?.has(role))
      ),
    ];

    // One candidate's score under each preference, in rank order: -1 better,
    // 0 neutral, +1 worse. `pool` is everyone being ranked together (PREFER
    // only marks B down when A is actually in the running).
    const preferenceScore = (
      user: SchedulerUser,
      role: string,
      pool: Set<string>,
      holders: (Set<string> | null)[]
    ): number[] =>
      preferences.map((r, i) => {
        const p = r.params;
        switch (p.kind) {
          case "ONLY_IF_NEEDED":
            return p.userId === user.id && (p.role === null || p.role === role) ? 1 : 0;
          case "PREFER":
            return p.role === role && p.otherUserId === user.id && pool.has(p.userId) ? 1 : 0;
          case "SAME_PLAYER":
            return holders[i]?.has(user.id) && !rolesOnSet.get(user.id)?.has(role) ? -1 : 0;
          case "TOGETHER": {
            const [a, b] = p.userIds;
            const other = a === user.id ? b : b === user.id ? a : null;
            if (!other || !onSet(other)) return 0;
            return p.mode === "ALWAYS" ? -1 : 1;
          }
          case "LIMIT":
            return p.userId === user.id && overLimit(user.id, p.max, p.period, r.teamId ?? null)
              ? 1
              : 0;
          case "SHARE_ROLES":
            return p.role === role && holdsOneOf(user.id, new Set(p.withRoles)) ? -1 : 0;
          case "MD_ORDER":
            return 0; // read by the MD pass, not a per-pick preference
        }
      });

    // Order candidates (each with the role they'd take): preferences first,
    // then rotation; then a REQUIRED "A over B" lifts A above B wherever
    // they landed.
    const rank = (cands: { user: SchedulerUser; role: string }[]) => {
      const pool = new Set(cands.map((c) => c.user.id));
      const holdersByRole = new Map<string, (Set<string> | null)[]>();
      const holdersFor = (role: string) => {
        let h = holdersByRole.get(role);
        if (!h) {
          h = preferences.map((r) =>
            r.params.kind === "SAME_PLAYER" ? new Set(partnerHolders(set, r.params, role)) : null
          );
          holdersByRole.set(role, h);
        }
        return h;
      };
      const scores = new Map(
        cands.map((c) => [c.user.id, preferenceScore(c.user, c.role, pool, holdersFor(c.role))])
      );
      const sorted = [...cands].sort((x, y) => {
        const sx = scores.get(x.user.id)!;
        const sy = scores.get(y.user.id)!;
        for (let i = 0; i < sx.length; i++) if (sx[i] !== sy[i]) return sx[i] - sy[i];
        return byRotation(x.user, y.user);
      });
      // Bounded: the PUT route refuses a cycle of required PREFERs, but a
      // stale list must still never spin.
      for (let pass = 0; pass <= requiredPrefers.length; pass++) {
        let moved = false;
        for (const p of requiredPrefers) {
          const ia = sorted.findIndex((c) => c.user.id === p.userId && c.role === p.role);
          const ib = sorted.findIndex((c) => c.user.id === p.otherUserId && c.role === p.role);
          if (ia > ib && ib >= 0) {
            const [a] = sorted.splice(ia, 1);
            sorted.splice(ib, 0, a);
            moved = true;
          }
        }
        if (!moved) break;
      }
      return sorted;
    };

    // Rank the candidates for a role, honoring availability, the
    // one-slot-per-person rule (plus its lone overlap exception) and the
    // required rules. MDs are ordinary players here — they may fill any role
    // on any set; being the set's designated MD is a separate choice
    // (Set.mdUserId, see lib/md.ts).
    //
    // Returns HOLD when a required SAME_PLAYER rule reserves this slot for
    // someone who can't take it: the caller leaves that slot open. `reserved`
    // says the list is only those owed it. `held` is
    // how many slots of this role have already been held that way, so a role
    // with more slots than owed players still fills the rest normally.
    const pickFor = (
      role: Instrument,
      // Extra hard filter on candidates (e.g. "already seated as WL/vocals" for
      // the shared-role pass below). Defaults to no restriction.
      eligible: (u: SchedulerUser) => boolean = () => true,
      held = 0
    ): { ranked: SchedulerUser[]; reserved: boolean } | typeof HOLD => {
      let pool = users
        // Eligible = plays this role on the set's team (team-restricted set), or
        // on any team for a team-less set. A person on the team with no roles
        // for it is naturally excluded — rolesFor returns [].
        .filter((u) => rolesFor(u, set).includes(role))
        .filter((u) => eligible(u))
        .filter((u) => canTakeRole(u.id, role))
        .filter((u) => isUserAvailable(u.id, set, rules))
        .filter((u) => passesRequired(u.id, role, true));
      const owedTo = owed(role, "REQUIRED");
      const reserved = owedTo.length > held;
      if (reserved) {
        pool = pool.filter((u) => owedTo.includes(u.id));
        if (pool.length === 0) return HOLD;
      }
      return { ranked: rank(pool.map((user) => ({ user, role }))).map((c) => c.user), reserved };
    };

    // Everyone a required ALWAYS rule ties `userId` to, through any chain of
    // them (A–B and B–C tie A to C), in a fixed order.
    const requiredGroup = (userId: string): string[] => {
      const out: string[] = [];
      const seen = new Set([userId]);
      const queue = [userId];
      while (queue.length) {
        for (const other of alwaysRequired.get(queue.shift()!) ?? []) {
          if (seen.has(other)) continue;
          seen.add(other);
          out.push(other);
          queue.push(other);
        }
      }
      return out;
    };

    // Seat someone and their WHOLE required-ALWAYS group, each partner in the
    // first open role they play — or nobody: if any of them can't be seated,
    // every seat this made is taken back and the answer is false.
    const seatGroup = (userId: string, role: Instrument): boolean => {
      const mark = picks.length;
      assign(userId, role);
      for (const other of requiredGroup(userId)) {
        if (onSet(other)) continue;
        const r =
          isUserAvailable(other, set, rules) && passesRequired(other, undefined, false)
            ? openRoleFor(other)
            : undefined;
        if (!r) {
          undoPicks(mark);
          return false;
        }
        assign(other, r);
      }
      return true;
    };

    // Seat someone (with their required group), then — best effort — the
    // people a PREFERENCE ALWAYS pairs with anyone just seated, and theirs in
    // turn. False only when the person themselves couldn't be seated.
    const seat = (userId: string, role: Instrument): boolean => {
      const mark = picks.length;
      if (!seatGroup(userId, role)) return false;
      for (let i = mark; i < picks.length; i++) {
        for (const other of alwaysPreferred.get(picks[i].userId) ?? []) {
          if (onSet(other)) continue;
          if (!isUserAvailable(other, set, rules) || !passesRequired(other, undefined, false)) {
            continue;
          }
          const r = openRoleFor(other);
          if (r) seatGroup(other, r);
        }
      }
      return true;
    };

    // Fill ONE seat of `role`: the best-ranked candidate who can actually be
    // seated (with their group) gets it. HOLD = a required SAME_PLAYER rule
    // keeps it for someone who can't take it; "none" = nobody can.
    const fillOne = (
      role: Instrument,
      eligible: ((u: SchedulerUser) => boolean) | undefined,
      held: number,
      place: (userId: string, role: Instrument) => boolean = seat
    ): "seated" | typeof HOLD | "none" => {
      const found = pickFor(role, eligible, held);
      if (found === HOLD) return HOLD;
      for (const u of found.ranked) if (place(u.id, role)) return "seated";
      return found.reserved ? HOLD : "none";
    };

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
      const openMDRoles = mdRoles.filter(
        (r) => catalog.some((c) => c.key === r) && (remaining[r] ?? 0) > 0
      );
      const ranked = rank(
        users
          .filter((u) => u.isMD)
          .filter((u) => isUserAvailable(u.id, set, rules))
          .map((u) => ({
            user: u,
            // Their most preferred open MD role, or undefined if they play none.
            role: openMDRoles.find(
              (r) =>
                rolesFor(u, set).includes(r) &&
                canTakeRole(u.id, r) &&
                // A host-only shared role isn't the MD's to walk into either.
                !sharedRoles.get(r)?.requiredHosts.size &&
                passesRequired(u.id, r, true) &&
                // A seat a required SAME_PLAYER rule holds for someone else
                // isn't the MD's to take.
                (owed(r, "REQUIRED").length === 0 || owed(r, "REQUIRED").includes(u.id))
            ),
          }))
          .filter((c): c is { user: SchedulerUser; role: Instrument } => !!c.role)
      );
      // The first who can be seated with their whole required group.
      for (const c of ranked) if (seat(c.user.id, c.role as Instrument)) break;
    };

    // One complete fill of this set's open slots. `reserveMD` seats an MD
    // first, which bends the rotation, so only the retry below passes it.
    const fillSet = (reserveMD: boolean) => {
      if (reserveMD) seatMD();

      // ── Normal greedy fill of the remaining slots ─────────────────────
      // Every slotted role is capacity-filled here, choir included — except a
      // SHARED role, which waits for its own pass below: its first candidates
      // are people ALREADY seated in a host role, and those are only all seated
      // once everything else is.
      for (const { key: role } of fillOrder) {
        if (sharedRoles.has(role)) continue;
        let held = 0;
        while (remaining[role] - held > 0) {
          const result = fillOne(role, undefined, held);
          if (result === HOLD) {
            held++; // reserved by a required SAME_PLAYER rule — leave it open
            continue;
          }
          if (result === "none") break; // nobody left for this role — leave slot empty
        }
      }

      // ── Shared roles: seated hosts first (SHARED ROLES above) ──────────
      // Under a required rule only a host who plays the role may take it, and
      // the slot is left empty if none do. Under a preference, hosts rank first
      // (preferenceScore) and anyone who plays it is the fallback.
      for (const { key: role } of fillOrder) {
        const shared = sharedRoles.get(role);
        if (!shared) continue;
        const hostOnly = shared.requiredHosts.size > 0;
        let held = 0;
        while ((remaining[role] ?? 0) - held > 0) {
          const result = fillOne(
            role,
            hostOnly ? (u) => holdsOneOf(u.id, shared.requiredHosts) : undefined,
            held,
            // A host is already on the set, so their group already is too.
            hostOnly ? (id, r) => (assign(id, r), true) : seat
          );
          if (result === HOLD) {
            held++;
            continue;
          }
          if (result === "none") break;
        }
      }
    };

    // Can the roster as filled supply an MD? Same rule the app designates one
    // with (lib/md.ts): an MD in an MD-capable role who isn't the worship
    // leader. Pre-assigned seats count — a hand-picked MD needs no reservation.
    const rosterCanLead = () =>
      eligibleMDIds(
        [
          ...preAssigned,
          ...picks.map((p) => ({
            userId: p.userId,
            role: p.role,
            isMD: isMDById.get(p.userId) ?? false,
          })),
        ],
        null,
        mdRoles
      ).length > 0;

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
