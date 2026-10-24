// Which seats on a staged plan break a scheduling rule.
//
// Rules exist to STEER Auto schedule. They are not permissions: an admin may
// seat anyone anywhere, and nothing here can stop a save (the server never
// consults rules when writing a roster). What this file does is NAME what an
// admin is about to do — a yellow outline and a "(!)" on the seat, and the list
// the save confirmation shows — so breaking a rule is a choice rather than a
// surprise.
//
// Only rules a FINISHED roster can be judged against are checked:
//
//   TOGETHER      both of a never-pair on one set; one of an always-pair alone
//   LIMIT         more sets in the week/month than the cap allows
//   SAME_PLAYER   two linked sets whose role went to different people
//   ROLE_HOST     a hosted role (acoustic guitar) held by nobody's host
//   double role   two roles on one set that may not be doubled
//
// ONLY_IF_NEEDED and PREFER are deliberately absent: both are about who was
// passed over, which a roster no longer records — "Hannah plays only if nobody
// else can" cannot be contradicted by the sight of Hannah on a set, because
// she may well have been the only one free. LEADS_FROM governs the MD
// designation, not a seat.
//
// Pure (no prisma, no react): tests/unit/ruleWarnings.test.ts.
import {
  ACOUSTIC_GUITAR,
  ACOUSTIC_HOST_ROLES,
  MD_ROLES,
  OVERLAP_ALLOWED_PAIRS,
} from "./constants";
import { APP_TZ } from "./appTz";
import {
  periodKey,
  resolveRoleBehavior,
  ruleSentence,
  scopeCovers,
  type RuleKind,
  type RuleNames,
  type RuleParams,
  type RuleTier,
  type SchedulingRule,
} from "./schedulingRules";

export interface WarningSeat {
  userId: string;
  role: string;
}

/** One set of a plan, as little of it as the checks need. */
export interface WarningSet {
  /** Stable identity within the plan (StagedScheduleModal's stagingKey). */
  key: string;
  /** The real Set row, when there is one — SAME_PLAYER "once" names set ids. */
  setId?: string | null;
  startsAt: Date;
  teamId?: string | null;
  templateId?: string | null;
  seats: WarningSeat[];
}

/** A booking OUTSIDE the plan, so a LIMIT counts the month, not just the plan. */
export interface WarningBooking {
  userId: string;
  startsAt: Date;
  teamId?: string | null;
  /**
   * Which set it is. Preview Mode previews sets that are already in the db, so
   * its own staged copy and this row are the same booking — without the id
   * they'd be counted twice and every seat past the cap would be marked.
   */
  setId?: string | null;
}

/**
 * Why one seat is marked. `ruleId` is null for the one warning no rule owns —
 * two roles on a set that may not be doubled is the BUILT-IN default, so there
 * is nothing for the admin to go and change.
 */
export interface SeatWarning {
  kind: RuleKind | "DOUBLE_ROLE";
  tier: RuleTier;
  ruleId: string | null;
  params: RuleParams | null;
  /** The two roles, for DOUBLE_ROLE. */
  roles?: [string, string];
}

export interface RuleWarnings {
  /** seatKey → every reason that seat is marked. */
  bySeat: Map<string, SeatWarning[]>;
  /** set key → how many of its seats are marked. */
  bySet: Map<string, number>;
  /** How many seats are marked across the plan. */
  total: number;
}

/** The one spelling of a seat's identity, shared by the checks and the UI. */
export const seatKey = (setKey: string, userId: string, role: string) =>
  `${setKey}|${userId}|${role}`;

const EMPTY: RuleWarnings = { bySeat: new Map(), bySet: new Map(), total: 0 };

export function ruleWarnings(
  sets: WarningSet[],
  rules: SchedulingRule[] | undefined,
  opts: { bookings?: WarningBooking[]; timeZone?: string } = {}
): RuleWarnings {
  const active = (rules ?? []).filter((r) => r.enabled);
  if (sets.length === 0) return EMPTY;
  const tz = opts.timeZone ?? APP_TZ;

  const bySeat = new Map<string, SeatWarning[]>();
  const mark = (set: WarningSet, seat: WarningSeat, w: SeatWarning) => {
    const key = seatKey(set.key, seat.userId, seat.role);
    const list = bySeat.get(key);
    if (!list) bySeat.set(key, [w]);
    // One rule marks a seat once, however many ways the check reached it.
    else if (!list.some((x) => x.ruleId === w.ruleId && x.kind === w.kind)) {
      list.push(w);
    }
  };
  /** Every seat `userId` holds on `set` — someone doubling up gets both marked. */
  const seatsOf = (set: WarningSet, userId: string) =>
    set.seats.filter((s) => s.userId === userId);
  const from = (r: SchedulingRule): SeatWarning => ({
    kind: r.params.kind,
    tier: r.tier,
    ruleId: r.id,
    params: r.params,
  });

  const inScope = (r: SchedulingRule, set: WarningSet) =>
    scopeCovers(r.teamId, set.teamId ?? null);

  // ── TOGETHER ────────────────────────────────────────────────────────────
  for (const r of active) {
    const p = r.params;
    if (p.kind !== "TOGETHER") continue;
    const [a, b] = p.userIds;
    for (const set of sets) {
      if (!inScope(r, set)) continue;
      const onA = seatsOf(set, a);
      const onB = seatsOf(set, b);
      if (p.mode === "NEVER") {
        if (onA.length > 0 && onB.length > 0) {
          for (const seat of [...onA, ...onB]) mark(set, seat, from(r));
        }
      } else if (onA.length > 0 !== onB.length > 0) {
        // "Always together" and only one of them is here.
        for (const seat of [...onA, ...onB]) mark(set, seat, from(r));
      }
    }
  }

  const planIds = new Set(sets.flatMap((s) => (s.setId ? [s.setId] : [])));

  // ── LIMIT ───────────────────────────────────────────────────────────────
  // The cap counts SETS, not seats, so doubling up on one set is one booking.
  // Bookings outside the plan count too, and the seats marked are the ones
  // past the cap in date order — the overflow, not everything that person has.
  for (const r of active) {
    const p = r.params;
    if (p.kind !== "LIMIT") continue;
    // A per-person cap is one person; `userId: null` caps everyone, each
    // separately.
    const people = p.userId
      ? [p.userId]
      : [...new Set(sets.flatMap((s) => s.seats.map((x) => x.userId)))];
    for (const userId of people) {
      // period → the plan's sets this person is on, oldest first, plus how
      // many bookings outside the plan already sit in that period.
      const planned = new Map<number, WarningSet[]>();
      const outside = new Map<number, number>();
      for (const set of sets) {
        if (seatsOf(set, userId).length === 0) continue;
        const k = periodKey(set.startsAt, p.period, tz);
        planned.set(k, [...(planned.get(k) ?? []), set]);
      }
      for (const b of opts.bookings ?? []) {
        if (b.userId !== userId) continue;
        // A booking on a set the plan holds is that set's staged seats seen a
        // second time, so it isn't "outside".
        if (b.setId && planIds.has(b.setId)) continue;
        const k = periodKey(b.startsAt, p.period, tz);
        outside.set(k, (outside.get(k) ?? 0) + 1);
      }
      for (const [k, list] of planned) {
        const already = outside.get(k) ?? 0;
        const ordered = [...list].sort(
          (x, y) => x.startsAt.getTime() - y.startsAt.getTime()
        );
        ordered.forEach((set, i) => {
          if (already + i + 1 <= p.max) return; // still within the cap
          if (!inScope(r, set)) return;
          for (const seat of seatsOf(set, userId)) mark(set, seat, from(r));
        });
      }
    }
  }

  // ── SAME_PLAYER ─────────────────────────────────────────────────────────
  // Two sets that should share a role's player. Only checkable when the plan
  // holds both of them: one set alone says nothing about the other.
  const holders = (set: WarningSet, role: string) =>
    set.seats.filter((s) => s.role === role);
  const flagMismatch = (r: SchedulingRule, a: WarningSet, b: WarningSet) => {
    const p = r.params as Extract<RuleParams, { kind: "SAME_PLAYER" }>;
    const ha = holders(a, p.role);
    const hb = holders(b, p.role);
    if (ha.length === 0 || hb.length === 0) return; // a hole, not a mismatch
    const sameone = ha.some((x) => hb.some((y) => y.userId === x.userId));
    if (sameone) return;
    for (const [set, seats] of [
      [a, ha],
      [b, hb],
    ] as const) {
      if (!inScope(r, set)) continue;
      for (const seat of seats) mark(set, seat, from(r));
    }
  };
  for (const r of active) {
    const p = r.params;
    if (p.kind !== "SAME_PLAYER") continue;
    if (p.scope === "ONCE") {
      const a = sets.find((s) => s.setId === p.setIds[0]);
      const b = sets.find((s) => s.setId === p.setIds[1]);
      if (a && b) flagMismatch(r, a, b);
      continue;
    }
    // WEEKLY: the pair of templates, matched up within each Mon–Sun week.
    const weeks = new Map<number, WarningSet[]>();
    for (const set of sets) {
      const k = periodKey(set.startsAt, "WEEK", tz);
      weeks.set(k, [...(weeks.get(k) ?? []), set]);
    }
    for (const week of weeks.values()) {
      const a = week.find((s) => s.templateId === p.templateIds[0]);
      const b = week.find((s) => s.templateId === p.templateIds[1]);
      if (a && b) flagMismatch(r, a, b);
    }
  }

  // ── Role-shaped behaviour: hosted roles, and doubling up ────────────────
  // Resolved per team, like the scheduler's own (lib/scheduler.ts rulesFor):
  // disabled rules matter here, since a role rule present but OFF means the
  // behaviour is off, where no rule at all means the built-in default.
  const behaviorCache = new Map<
    string,
    ReturnType<typeof resolveRoleBehavior>
  >();
  const behaviorFor = (teamId: string | null | undefined) => {
    const key = teamId ?? "";
    let b = behaviorCache.get(key);
    if (!b) {
      b = resolveRoleBehavior(
        (rules ?? []).filter((r) => scopeCovers(r.teamId, teamId ?? null)),
        {
          mdRoles: MD_ROLES,
          hostRoles: { [ACOUSTIC_GUITAR]: ACOUSTIC_HOST_ROLES },
          doublePairs: OVERLAP_ALLOWED_PAIRS,
        }
      );
      behaviorCache.set(key, b);
    }
    return b;
  };
  // Which rule to point at for a hosted role, when one says so rather than
  // lib/constants.ts. Null attribution reads as "that's the built-in default".
  const hostRuleFor = (teamId: string | null | undefined, role: string) =>
    active.find(
      (r) =>
        r.params.kind === "ROLE_HOST" &&
        r.params.role === role &&
        scopeCovers(r.teamId, teamId ?? null)
    ) ?? null;

  for (const set of sets) {
    const behavior = behaviorFor(set.teamId);
    const rolesByUser = new Map<string, string[]>();
    for (const seat of set.seats) {
      rolesByUser.set(seat.userId, [
        ...(rolesByUser.get(seat.userId) ?? []),
        seat.role,
      ]);
    }

    for (const seat of set.seats) {
      const hosts = behavior.hostRolesFor(seat.role);
      if (!hosts) continue;
      const held = rolesByUser.get(seat.userId) ?? [];
      if (held.some((role) => hosts.includes(role))) continue;
      const rule = hostRuleFor(set.teamId, seat.role);
      mark(set, seat, {
        kind: "ROLE_HOST",
        tier: rule?.tier ?? "REQUIRED",
        ruleId: rule?.id ?? null,
        params: rule?.params ?? null,
      });
    }

    for (const [userId, held] of rolesByUser) {
      if (held.length < 2) continue;
      for (let i = 0; i < held.length; i++) {
        for (let j = i + 1; j < held.length; j++) {
          if (behavior.mayDouble(held[i], held[j])) continue;
          const roles: [string, string] = [held[i], held[j]];
          for (const role of roles) {
            mark(
              set,
              { userId, role },
              {
                kind: "DOUBLE_ROLE",
                tier: "REQUIRED",
                ruleId: null,
                params: null,
                roles,
              }
            );
          }
        }
      }
    }
  }

  const bySet = new Map<string, number>();
  for (const set of sets) {
    const n = set.seats.filter((s) =>
      bySeat.has(seatKey(set.key, s.userId, s.role))
    ).length;
    if (n > 0) bySet.set(set.key, n);
  }

  return { bySeat, bySet, total: bySeat.size };
}

/** A seat's reason as one sentence, for the (!) tooltip and the save list. */
export function describeSeatWarning(w: SeatWarning, names: RuleNames): string {
  if (w.kind === "DOUBLE_ROLE") {
    const [a, b] = w.roles ?? ["", ""];
    return `${names.role(a)} and ${names.role(b)} aren't played by the same person on one set`;
  }
  if (!w.params) {
    return "Breaks a scheduling rule";
  }
  return ruleSentence(w.params, names);
}

/** "Required" / "Preference", for the tag beside a row in the save list. */
export const warningTierLabel = (tier: RuleTier) =>
  tier === "REQUIRED" ? "Required" : "Preference";
