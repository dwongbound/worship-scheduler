// Randomized scenarios for the auto-fill (lib/scheduler.ts). Each scenario is
// a made-up org — teams, people with per-team roles, availability blocks, a
// run of sets with their own shapes, hand-picked seats, and a random list of
// scheduling rules (some scoped to a team, some switched off) — and every
// schedule the fill produces is checked against the rules it was given.
//
// The checks are the promises the rules editor makes, written as properties
// that must hold for ANY input rather than for one hand-built case:
//   • seats: only people who play the role on that team, are free, and fit
//     the set's shape; nobody in the same role twice;
//   • two roles on one set only where a SHARE_ROLES rule allows that pair,
//     and a required shared role only ever goes to someone doubling up;
//   • required NEVER / ALWAYS / LIMIT / SAME_PLAYER hold, each on its own team;
//   • a required-MD set is left unled only when no MD could have led it under
//     the team's MD order;
//   • an open slot with no required rule behind it means nobody free was left;
//   • the run is deterministic, a rule for a team with no sets changes nothing,
//     a switched-off rule is the same as no rule, and "no list" = the defaults.
//
// Seeded, so a failure names its seed and reproduces exactly: set SEED to that
// number and the one scenario re-runs.
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  isUserAvailable,
  type ProposedAssignment,
  type SchedulerSet,
  type SchedulerUser,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import { eligibleMDIds } from "@/lib/md";
import {
  DEFAULT_RULES,
  NOT_MD_ROLES,
  RULE_KINDS,
  findContradiction,
  mdRolesFor,
  ruleAppliesTo,
  weekKey,
  monthKey,
  type RuleParams,
  type RuleTier,
  type SchedulingRule,
} from "@/lib/schedulingRules";
import {
  DEFAULT_TEAM_ROLES,
  resolveTeamCapacities,
  slottedRoles,
  teamSupportsMD,
} from "@/lib/teamRoles";

const TZ = "America/Los_Angeles";
const SCENARIOS = 400;
// A single seed to replay, from a failure message.
const SEED: number | null = null;

// ── A small seeded PRNG (mulberry32) ───────────────────────────────────────

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)];
  const chance = (p: number) => next() < p;
  const sample = <T,>(list: readonly T[], n: number): T[] => {
    const copy = [...list];
    const out: T[] = [];
    while (out.length < n && copy.length) out.push(copy.splice(Math.floor(next() * copy.length), 1)[0]);
    return out;
  };
  return { next, int, pick, chance, sample };
}

// ── Scenario generation ────────────────────────────────────────────────────

const ROLE_KEYS = slottedRoles(DEFAULT_TEAM_ROLES)
  .map((r) => r.key)
  .filter((k) => k !== "CHOIR");
// A team no set belongs to — rules scoped to it must change nothing.
const GHOST_TEAM = "team-ghost";

interface Scenario {
  seed: number;
  teams: string[];
  users: SchedulerUser[];
  sets: SchedulerSet[];
  unavailable: UnavailabilityRule[];
  rules: SchedulingRule[];
}

function scenario(seed: number): Scenario {
  const r = rng(seed);
  const teams = Array.from({ length: r.int(1, 2) }, (_, i) => `team-${i + 1}`);

  const users: SchedulerUser[] = Array.from({ length: r.int(3, 16) }, (_, i) => {
    const onTeams = r.sample(teams, r.int(1, teams.length));
    return {
      id: `u${String(i).padStart(2, "0")}`,
      isMD: r.chance(0.3),
      rolesByTeam: Object.fromEntries(onTeams.map((t) => [t, r.sample(ROLE_KEYS, r.int(1, 3))])),
    };
  });

  // Distinct start times across six weeks (the fill doesn't model one person
  // on two simultaneous sets, so the scenarios don't ask it to).
  const times = new Set<number>();
  const sets: SchedulerSet[] = [];
  for (let i = 0, n = r.int(1, 8); i < n; i++) {
    let at: Date;
    do {
      at = new Date(2026, 1, 1 + r.int(0, 41), r.pick([9, 11, 18, 19, 20]), r.pick([0, 30]));
    } while (times.has(at.getTime()));
    times.add(at.getTime());
    const teamId = r.chance(0.15) ? null : r.pick(teams);
    const capacities = Object.fromEntries(ROLE_KEYS.map((k) => [k, r.pick([0, 1, 1, 1, 2])]));
    const set: SchedulerSet = {
      id: `run-${i}`,
      setId: `set-${i}`,
      templateId: r.chance(0.5) ? r.pick(["tpl-a", "tpl-b"]) : null,
      startsAt: at,
      durationMinutes: r.pick([60, 90, 120]),
      teamId,
      roles: DEFAULT_TEAM_ROLES,
      capacities,
      requiresMD: r.chance(0.4),
    };
    if (r.chance(0.25)) {
      const pre: NonNullable<SchedulerSet["preAssigned"]> = [];
      for (let k = r.int(1, 2); k > 0; k--) {
        const u = r.pick(users);
        const plays = teamId ? u.rolesByTeam[teamId] ?? [] : Object.values(u.rolesByTeam).flat();
        if (!plays.length) continue;
        const role = r.pick(plays);
        if (pre.some((p) => p.userId === u.id)) continue;
        pre.push({ userId: u.id, role, isMD: u.isMD });
      }
      set.preAssigned = pre;
    }
    sets.push(set);
  }

  const unavailable: UnavailabilityRule[] = [];
  for (const u of users) {
    for (let k = r.int(0, 2); k > 0; k--) {
      if (r.chance(0.5)) {
        const start = r.pick([0, 8, 12, 17]) * 60;
        unavailable.push({
          userId: u.id,
          type: "RECURRING",
          dayOfWeek: r.int(0, 6),
          startMinute: start,
          endMinute: start + r.pick([120, 240, 600]),
        });
      } else {
        const day = r.pick(sets).startsAt;
        const start = r.pick([0, 8, 17]) * 60;
        unavailable.push({
          userId: u.id,
          type: "SPECIFIC",
          startDate: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
          startMinute: start,
          endMinute: start + r.pick([180, 420, 1440 - start]),
        });
      }
    }
  }

  // Rules: optionally the defaults, then a random handful of every kind. A
  // contradicting required rule is dropped, as the editor and PUT would.
  const rules: SchedulingRule[] = r.chance(0.6)
    ? DEFAULT_RULES.map((d, i) => ({ ...d, id: `d${i}` }))
    : [];
  const ids = users.map((u) => u.id);
  for (let k = r.int(0, 7); k > 0; k--) {
    const kind = r.pick(RULE_KINDS).kind;
    const two = r.sample(ids, 2);
    const role = r.pick(ROLE_KEYS);
    let params: RuleParams;
    switch (kind) {
      case "ONLY_IF_NEEDED":
        params = { kind, userId: r.pick(ids), role: r.chance(0.5) ? role : null };
        break;
      case "PREFER":
        if (two.length < 2) continue;
        params = { kind, userId: two[0], otherUserId: two[1], role };
        break;
      case "SAME_PLAYER":
        if (r.chance(0.5)) {
          params = { kind, role, scope: "WEEKLY", templateIds: ["tpl-a", "tpl-b"] };
        } else {
          if (sets.length < 2) continue;
          const [a, b] = r.sample(sets, 2);
          params = { kind, role, scope: "ONCE", setIds: [a.setId!, b.setId!] };
        }
        break;
      case "TOGETHER":
        if (two.length < 2) continue;
        params = { kind, userIds: [two[0], two[1]], mode: r.chance(0.5) ? "ALWAYS" : "NEVER" };
        break;
      case "LIMIT":
        params = { kind, userId: r.pick(ids), max: r.int(1, 3), period: r.chance(0.5) ? "WEEK" : "MONTH" };
        break;
      case "MD_ORDER":
        params = { kind, roles: r.sample(ROLE_KEYS.filter((k) => !NOT_MD_ROLES.includes(k)), r.int(1, 3)) };
        break;
      case "SHARE_ROLES": {
        const [shared, ...hosts] = r.sample(ROLE_KEYS, r.int(2, 3));
        params = { kind, role: shared, withRoles: hosts };
        break;
      }
    }
    const tiers = RULE_KINDS.find((x) => x.kind === kind)!.tiers;
    const rule: SchedulingRule = {
      id: `r${k}`,
      tier: r.pick(tiers) as RuleTier,
      enabled: r.chance(0.85),
      teamId: r.chance(0.6) ? null : r.pick([...teams, GHOST_TEAM]),
      params,
    };
    if (!findContradiction([...rules, rule])) rules.push(rule);
  }

  return { seed, teams, users, sets, unavailable, rules };
}

// `rules` "none" = pass no list at all (the defaults); omitted = the scenario's.
const fill = (s: Scenario, rules: SchedulingRule[] | "none" = s.rules) =>
  buildSchedule(s.sets, s.users, s.unavailable, new Map(), [], new Map(), {
    schedulingRules: rules === "none" ? undefined : rules,
    timeZone: TZ,
  });

// ── What the checks read ───────────────────────────────────────────────────

const playsOn = (u: SchedulerUser, set: SchedulerSet) =>
  set.teamId ? u.rolesByTeam[set.teamId] ?? [] : Object.values(u.rolesByTeam).flat();

/** Every seat on each set after the fill: hand-picked and proposed, tagged. */
function rosters(s: Scenario, result: ProposedAssignment[]) {
  const out = new Map<string, { userId: string; role: string; auto: boolean }[]>();
  for (const set of s.sets) {
    out.set(set.id, (set.preAssigned ?? []).map((p) => ({ userId: p.userId, role: p.role, auto: false })));
  }
  for (const p of result) out.get(p.setId)!.push({ userId: p.userId, role: p.role, auto: true });
  return out;
}

const applying = (s: Scenario, set: SchedulerSet) =>
  s.rules.filter((r) => r.enabled && ruleAppliesTo(r, set.teamId));

/** Each violated promise, in words. Empty = the schedule is right. */
function violations(s: Scenario, result: ProposedAssignment[]): string[] {
  const bad: string[] = [];
  const byId = new Map(s.users.map((u) => [u.id, u]));
  const seats = rosters(s, result);

  for (const set of s.sets) {
    const roster = seats.get(set.id)!;
    const rules = applying(s, set);
    const req = rules.filter((r) => r.tier === "REQUIRED");
    const shape = resolveTeamCapacities(set.roles ?? DEFAULT_TEAM_ROLES, set.capacities);
    const shares = rules.flatMap((r) => (r.params.kind === "SHARE_ROLES" ? [{ tier: r.tier, ...r.params }] : []));
    const pairOk = (a: string, b: string) =>
      shares.some((x) => (x.role === a && x.withRoles.includes(b)) || (x.role === b && x.withRoles.includes(a)));
    const hostOnly = new Map<string, string[]>();
    for (const x of shares) {
      if (x.tier === "REQUIRED") hostOnly.set(x.role, [...(hostOnly.get(x.role) ?? []), ...x.withRoles]);
    }
    const on = (userId: string) => roster.some((a) => a.userId === userId);
    const rolesOf = (userId: string) => roster.filter((a) => a.userId === userId).map((a) => a.role);

    for (const a of roster.filter((x) => x.auto)) {
      const u = byId.get(a.userId)!;
      const where = `${a.userId} as ${a.role} on ${set.id}`;
      if (!playsOn(u, set).includes(a.role)) bad.push(`${where}: doesn't play it on this team`);
      if (!isUserAvailable(a.userId, set, s.unavailable, TZ)) bad.push(`${where}: unavailable`);
      for (const other of rolesOf(a.userId)) {
        if (other !== a.role && !pairOk(a.role, other)) bad.push(`${where}: also ${other}, no rule shares them`);
      }
      const hosts = hostOnly.get(a.role);
      if (hosts && !rolesOf(a.userId).some((x) => hosts.includes(x))) {
        bad.push(`${where}: a required shared role, but not doubling as ${hosts.join("/")}`);
      }
    }

    // The shape, and one person per seat.
    const seen = new Set<string>();
    for (const a of roster) {
      const k = `${a.userId}|${a.role}`;
      if (seen.has(k)) bad.push(`${a.userId} twice as ${a.role} on ${set.id}`);
      seen.add(k);
    }
    for (const role of new Set(roster.filter((a) => a.auto).map((a) => a.role))) {
      const pre = roster.filter((a) => !a.auto && a.role === role).length;
      const auto = roster.filter((a) => a.auto && a.role === role).length;
      if (auto > Math.max(0, (shape[role] ?? 0) - pre)) bad.push(`${set.id}: ${role} over its ${shape[role] ?? 0} seats`);
    }

    // Required TOGETHER.
    for (const r of req) {
      if (r.params.kind !== "TOGETHER") continue;
      const [x, y] = r.params.userIds;
      const autoX = roster.some((a) => a.userId === x && a.auto);
      const autoY = roster.some((a) => a.userId === y && a.auto);
      if (r.params.mode === "NEVER" && on(x) && on(y) && (autoX || autoY)) {
        bad.push(`${set.id}: ${x} and ${y} must never serve together`);
      }
      if (r.params.mode === "ALWAYS") {
        const autoOnly = (id: string) => roster.some((a) => a.userId === id && a.auto) && !roster.some((a) => a.userId === id && !a.auto);
        if (autoOnly(x) && !on(y)) bad.push(`${set.id}: ${x} seated without ${y}`);
        if (autoOnly(y) && !on(x)) bad.push(`${set.id}: ${y} seated without ${x}`);
      }
    }

    // MD: a required-MD set may be unled only if no MD could have led it.
    // Checked where no other required rule (or hand-picked seat) narrows who
    // may sit where, since those can legitimately keep an MD out.
    const catalog = set.roles ?? DEFAULT_TEAM_ROLES;
    const otherRequired = req.filter((r) => r.params.kind !== "MD_ORDER");
    if (set.requiresMD && teamSupportsMD(catalog) && !otherRequired.length && !(set.preAssigned ?? []).length) {
      const mdRoles = mdRolesFor(s.rules, set.teamId);
      const led = eligibleMDIds(
        roster.map((a) => ({ userId: a.userId, role: a.role, isMD: byId.get(a.userId)!.isMD })),
        null,
        mdRoles
      ).length;
      const couldLead = s.users.some(
        (u) =>
          u.isMD &&
          isUserAvailable(u.id, set, s.unavailable, TZ) &&
          mdRoles.some((r) => (shape[r] ?? 0) > 0 && playsOn(u, set).includes(r))
      );
      if (!led && couldLead) bad.push(`${set.id}: needs an MD and one was free`);
    }

    // An open seat with no required rule behind it means nobody free was left
    // to take it: everyone who plays it here is busy or already on the set.
    if (!req.some((r) => r.params.kind !== "MD_ORDER")) {
      for (const [role, cap] of Object.entries(shape)) {
        const filled = roster.filter((a) => a.role === role).length;
        if (filled >= cap || hostOnly.has(role)) continue;
        const idle = s.users.find(
          (u) => playsOn(u, set).includes(role) && !on(u.id) && isUserAvailable(u.id, set, s.unavailable, TZ)
        );
        if (idle) bad.push(`${set.id}: ${role} left open while ${idle.id} was free`);
      }
    }
  }

  // Required LIMIT: never more AUTO-seated sets in a period than the cap (a
  // hand-picked seat can't be undone, so it's the auto ones that must fit).
  for (const r of s.rules) {
    if (!r.enabled || r.tier !== "REQUIRED" || r.params.kind !== "LIMIT") continue;
    const { userId, max, period } = r.params;
    const buckets = new Map<number, Set<number>>();
    for (const set of s.sets) {
      if (!ruleAppliesTo(r, set.teamId)) continue;
      const roster = seats.get(set.id)!;
      const auto = roster.some((a) => a.userId === userId && a.auto) && !roster.some((a) => a.userId === userId && !a.auto);
      if (!auto) continue;
      const k = period === "WEEK" ? weekKey(set.startsAt, TZ) : monthKey(set.startsAt, TZ);
      buckets.set(k, (buckets.get(k) ?? new Set()).add(set.startsAt.getTime()));
    }
    for (const [k, times] of buckets) {
      if (times.size > max) bad.push(`${userId}: ${times.size} sets in ${period} ${k}, cap ${max}`);
    }
  }

  // Required SAME_PLAYER between two sets of the run: the later one's seats in
  // that role go to the earlier one's players first, as far as they reach.
  for (const r of s.rules) {
    if (!r.enabled || r.tier !== "REQUIRED" || r.params.kind !== "SAME_PLAYER" || r.params.scope !== "ONCE") continue;
    const p = r.params;
    const [x, y] = p.setIds.map((id) => s.sets.find((set) => set.setId === id)!);
    const [first, second] = x.startsAt < y.startsAt ? [x, y] : [y, x];
    if (!ruleAppliesTo(r, second.teamId)) continue;
    const holders = new Set(seats.get(first.id)!.filter((a) => a.role === p.role).map((a) => a.userId));
    const roster = seats.get(second.id)!;
    const pre = roster.filter((a) => !a.auto && a.role === p.role);
    const owed = [...holders].filter((id) => !pre.some((a) => a.userId === id)).length;
    const shape = resolveTeamCapacities(second.roles ?? DEFAULT_TEAM_ROLES, second.capacities);
    const open = Math.max(0, (shape[p.role] ?? 0) - pre.length);
    const strangers = roster.filter((a) => a.auto && a.role === p.role && !holders.has(a.userId)).length;
    if (strangers > Math.max(0, open - owed)) {
      bad.push(`${second.id}: ${p.role} went to someone other than ${first.id}'s player`);
    }
  }
  return bad;
}

// ── The properties ─────────────────────────────────────────────────────────

const seeds = SEED !== null ? [SEED] : Array.from({ length: SCENARIOS }, (_, i) => 1000 + i);

describe("auto-fill on random scenarios", () => {
  it("every schedule keeps every promise", () => {
    const failures: string[] = [];
    for (const seed of seeds) {
      const s = scenario(seed);
      const found = violations(s, fill(s));
      if (found.length) failures.push(`seed ${seed}: ${found.slice(0, 3).join("; ")}`);
    }
    expect(failures).toEqual([]);
  });

  it("the same input gives the same schedule", () => {
    for (const seed of seeds.slice(0, 100)) {
      const s = scenario(seed);
      expect(fill(s), `seed ${seed}`).toEqual(fill(s));
    }
  });

  it("a rule for a team with no sets here changes nothing", () => {
    for (const seed of seeds) {
      const s = scenario(seed);
      const real = s.rules.filter((r) => r.teamId !== GHOST_TEAM);
      expect(fill(s), `seed ${seed}`).toEqual(fill(s, real));
    }
  });

  it("a switched-off rule is the same as no rule", () => {
    for (const seed of seeds) {
      const s = scenario(seed);
      expect(fill(s), `seed ${seed}`).toEqual(fill(s, s.rules.filter((r) => r.enabled)));
    }
  });

  it("no list at all is the defaults every org starts with", () => {
    for (const seed of seeds.slice(0, 100)) {
      const s = scenario(seed);
      const defaults = DEFAULT_RULES.map((d, i) => ({ ...d, id: `x${i}` }));
      expect(fill(s, "none"), `seed ${seed}`).toEqual(fill(s, defaults));
    }
  });

  it("the scenarios actually exercise every kind of rule, on and off, scoped and not", () => {
    const kinds = new Set<string>();
    let scoped = 0;
    let off = 0;
    let filled = 0;
    for (const seed of seeds) {
      const s = scenario(seed);
      for (const r of s.rules) {
        kinds.add(`${r.params.kind}:${r.tier}`);
        if (r.teamId) scoped++;
        if (!r.enabled) off++;
      }
      filled += fill(s).length;
    }
    for (const k of RULE_KINDS) for (const t of k.tiers) expect(kinds).toContain(`${k.kind}:${t}`);
    expect(scoped).toBeGreaterThan(50);
    expect(off).toBeGreaterThan(50);
    expect(filled).toBeGreaterThan(SCENARIOS * 5);
  });
});
