// Unit tests for the auto-scheduling algorithm (lib/scheduler.ts).
import { describe, expect, it } from "vitest";
import {
  availableGuestMembers,
  buildSchedule,
  isUserAvailable,
  type SchedulerSet,
  type SchedulerUser,
  teamKey,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import { SLOT_CAPACITIES } from "@/lib/constants";

// A Tuesday evening set: 19:00–20:00.
const tuesdaySet: SchedulerSet = {
  id: "set-1",
  startsAt: new Date(2026, 0, 6, 19, 0), // Tue Jan 6 2026, 7pm local
  durationMinutes: 60,
};

// Default team every fixture user is placed on unless a test overrides it.
// Roles are per-team now, so a candidate must hold the role on SOME team to be
// eligible (a team-less set draws on the union across the person's teams).
const DEFAULT_TEAM = "team-default";

function user(
  id: string,
  roles: SchedulerUser["rolesByTeam"][string],
  isMD = false,
  teamIds: string | string[] = DEFAULT_TEAM
): SchedulerUser {
  const teams = Array.isArray(teamIds) ? teamIds : [teamIds];
  return {
    id,
    isMD,
    rolesByTeam: Object.fromEntries(teams.map((t) => [t, roles])),
  };
}

describe("isUserAvailable", () => {
  it("blocks a recurring rule that overlaps the set time", () => {
    const rules: UnavailabilityRule[] = [
      // Tuesday 18:00–20:00 — overlaps 19:00–20:00.
      { userId: "u1", type: "RECURRING", dayOfWeek: 2, startMinute: 1080, endMinute: 1200 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("allows a recurring rule on a different day", () => {
    const rules: UnavailabilityRule[] = [
      { userId: "u1", type: "RECURRING", dayOfWeek: 3, startMinute: 0, endMinute: 1440 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("allows a recurring rule on the same day but non-overlapping time", () => {
    const rules: UnavailabilityRule[] = [
      // Tuesday morning only — the evening set is fine.
      { userId: "u1", type: "RECURRING", dayOfWeek: 2, startMinute: 360, endMinute: 720 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("ignores a recurring rule that has stopped repeating", () => {
    const rules: UnavailabilityRule[] = [
      // Same Tuesday evening window, but it stopped repeating in December.
      {
        userId: "u1",
        type: "RECURRING",
        dayOfWeek: 2,
        startMinute: 1080,
        endMinute: 1200,
        endDate: new Date(2025, 11, 30),
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("blocks a recurring rule up to and including its last day", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "RECURRING",
        dayOfWeek: 2,
        startMinute: 1080,
        endMinute: 1200,
        endDate: new Date(2026, 0, 6), // the set's own day
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("blocks a date range containing the set (inclusive end date)", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "DATE_RANGE",
        startDate: new Date(2026, 0, 5), // Jan 5
        endDate: new Date(2026, 0, 6), // Jan 6 at midnight — still blocks the 7pm set
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("blocks a specific block on the same date with overlapping time", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "SPECIFIC",
        startDate: new Date(2026, 0, 6), // Jan 6 (same day as the set)
        startMinute: 1080, // 18:00
        endMinute: 1200, // 20:00 — overlaps the 19:00 set
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("blocks a specific block whose date range spans the set day", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "SPECIFIC",
        startDate: new Date(2026, 0, 5), // Jan 5
        endDate: new Date(2026, 0, 8), // through Jan 8 — Jan 6 is inside
        startMinute: 0,
        endMinute: 1440,
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(false);
  });

  it("allows a specific block whose range ends before the set day", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "SPECIFIC",
        startDate: new Date(2026, 0, 3),
        endDate: new Date(2026, 0, 5), // ends Jan 5 — the Jan 6 set is clear
        startMinute: 0,
        endMinute: 1440,
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("allows a specific block on a different date", () => {
    const rules: UnavailabilityRule[] = [
      {
        userId: "u1",
        type: "SPECIFIC",
        startDate: new Date(2026, 0, 13), // a week later
        startMinute: 0,
        endMinute: 1440,
      },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });

  it("ignores other users' rules", () => {
    const rules: UnavailabilityRule[] = [
      { userId: "someone-else", type: "RECURRING", dayOfWeek: 2, startMinute: 0, endMinute: 1440 },
    ];
    expect(isUserAvailable("u1", tuesdaySet, rules)).toBe(true);
  });
});

describe("buildSchedule", () => {
  it("respects slot capacities (max 4 vocals)", () => {
    const vocalists = ["v1", "v2", "v3", "v4", "v5", "v6"].map((id) =>
      user(id, ["VOCALS"])
    );
    const result = buildSchedule([tuesdaySet], vocalists, []);
    const vocals = result.filter((a) => a.role === "VOCALS");
    expect(vocals).toHaveLength(SLOT_CAPACITIES.VOCALS); // exactly 4
  });

  it("honors a per-set capacity override (2 electric guitars)", () => {
    const guitarists = ["g1", "g2", "g3"].map((id) => user(id, ["ELECTRIC_GUITAR"]));
    // Default is 2 electric guitars; make this set want 3.
    const set: SchedulerSet = { ...tuesdaySet, capacities: { ELECTRIC_GUITAR: 3 } };
    const result = buildSchedule([set], guitarists, []);
    expect(result.filter((a) => a.role === "ELECTRIC_GUITAR")).toHaveLength(3);
  });

  it("skips a role a set sets to 0 capacity", () => {
    const players = [user("a1", ["ACOUSTIC_GUITAR"]), user("d1", ["DRUMS"])];
    // Tuesday: no acoustic guitars wanted, but drums as usual.
    const set: SchedulerSet = { ...tuesdaySet, capacities: { ACOUSTIC_GUITAR: 0 } };
    const result = buildSchedule([set], players, []);
    expect(result.some((a) => a.role === "ACOUSTIC_GUITAR")).toBe(false);
    expect(result.some((a) => a.role === "DRUMS")).toBe(true);
  });

  it("never assigns the same user twice to one set (no allowed overlap)", () => {
    // One multi-instrumentalist whose skills don't form an allowed pair.
    const multi = user("m1", ["WORSHIP_LEADER", "KEYS", "DRUMS"]);
    const result = buildSchedule([tuesdaySet], [multi], []);
    expect(result).toHaveLength(1); // only one slot, despite three skills
  });

  it("lets one person be worship leader AND acoustic guitar", () => {
    const versatile = user("p1", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]);
    const roles = buildSchedule([tuesdaySet], [versatile], [])
      .map((a) => a.role)
      .sort();
    expect(roles).toEqual(["ACOUSTIC_GUITAR", "WORSHIP_LEADER"]);
  });

  it("lets acoustic guitar double as vox", () => {
    const versatile = user("p1", ["ACOUSTIC_GUITAR", "VOCALS"]);
    const roles = buildSchedule([tuesdaySet], [versatile], [])
      .map((a) => a.role)
      .sort();
    expect(roles).toEqual(["ACOUSTIC_GUITAR", "VOCALS"]);
  });

  it("leaves acoustic empty when no worship leader or vocalist plays it", () => {
    // a1 plays ONLY acoustic (not WL/vox), so the acoustic slot must stay empty
    // rather than seating a dedicated acoustic-only player. Drums fills as usual.
    const players = [user("a1", ["ACOUSTIC_GUITAR"]), user("d1", ["DRUMS"])];
    const result = buildSchedule([tuesdaySet], players, []);
    expect(result.some((a) => a.role === "ACOUSTIC_GUITAR")).toBe(false);
    expect(result).toContainEqual({ setId: "set-1", userId: "d1", role: "DRUMS" });
  });

  it("hands acoustic to a seated vocalist over an acoustic-only player", () => {
    // v1 sings AND plays acoustic; a1 only plays acoustic. The acoustic slot
    // goes to v1 (who is already a vocalist), and a1 is never seated.
    const v1 = user("v1", ["VOCALS", "ACOUSTIC_GUITAR"]);
    const a1 = user("a1", ["ACOUSTIC_GUITAR"]);
    const result = buildSchedule([tuesdaySet], [v1, a1], []);
    expect(result).toContainEqual({ setId: "set-1", userId: "v1", role: "VOCALS" });
    expect(result).toContainEqual({
      setId: "set-1",
      userId: "v1",
      role: "ACOUSTIC_GUITAR",
    });
    expect(result.some((a) => a.userId === "a1")).toBe(false);
  });

  it("leaves acoustic empty when the only vocalist doesn't play it", () => {
    // v1 sings but can't play acoustic; a1 plays acoustic but doesn't sing/lead.
    // Neither qualifies, so acoustic stays empty even though someone plays it.
    const v1 = user("v1", ["VOCALS"]);
    const a1 = user("a1", ["ACOUSTIC_GUITAR"]);
    const result = buildSchedule([tuesdaySet], [v1, a1], []);
    expect(result).toContainEqual({ setId: "set-1", userId: "v1", role: "VOCALS" });
    expect(result.some((a) => a.role === "ACOUSTIC_GUITAR")).toBe(false);
  });

  it("disallows a non-sanctioned overlap (keys + electric guitar)", () => {
    const player = user("p1", ["KEYS", "ELECTRIC_GUITAR"]);
    const result = buildSchedule([tuesdaySet], [player], []);
    expect(result).toHaveLength(1); // can't hold both
  });

  it("disallows the three-way worship leader + acoustic + vox", () => {
    // WL+acoustic and acoustic+vox are each allowed, but WL+vox is not — so the
    // trio can't all land on one person.
    const player = user("p1", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR", "VOCALS"]);
    const roles = buildSchedule([tuesdaySet], [player], [])
      .map((a) => a.role)
      .sort();
    expect(roles).toEqual(["ACOUSTIC_GUITAR", "WORSHIP_LEADER"]);
  });

  it("skips unavailable users and leaves the slot to someone else", () => {
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const rules: UnavailabilityRule[] = [
      // d1 is out every Tuesday.
      { userId: "d1", type: "RECURRING", dayOfWeek: 2, startMinute: 0, endMinute: 1440 },
    ];
    const result = buildSchedule([tuesdaySet], drummers, rules);
    expect(result).toEqual([{ setId: "set-1", userId: "d2", role: "DRUMS" }]);
  });

  it("leaves slots empty when nobody can fill them", () => {
    const result = buildSchedule([tuesdaySet], [user("d1", ["DRUMS"])], []);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("DRUMS");
    // No bass/keys/etc. proposals fabricated out of thin air.
  });

  it("load-balances across sets (2 drummers, 2 sets → 1 each)", () => {
    const sets: SchedulerSet[] = [
      tuesdaySet,
      { id: "set-2", startsAt: new Date(2026, 0, 13, 19, 0), durationMinutes: 60 },
    ];
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(sets, drummers, []);
    const byUser = new Set(result.map((a) => a.userId));
    expect(byUser.size).toBe(2); // both drummers used, not d1 twice
  });

  it("accounts for pre-existing assignment counts when balancing", () => {
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    // d1 already has 5 upcoming sets — d2 should get this one.
    const existing = new Map([["d1", 5]]);
    const result = buildSchedule([tuesdaySet], drummers, [], existing);
    expect(result[0].userId).toBe("d2");
  });

  it("only schedules people who play the role on the set's team", () => {
    const drummers = [
      user("d1", ["DRUMS"], false, "team-b"), // drums, but on team-b only
      user("d2", ["DRUMS"], false, ["team-a", "team-b"]), // drums on team-a too
    ];
    const set: SchedulerSet = { ...tuesdaySet, teamId: "team-a" };
    const result = buildSchedule([set], drummers, []);
    expect(result).toEqual([{ setId: "set-1", userId: "d2", role: "DRUMS" }]);
  });

  it("leaves a slot empty when no one plays the role on the set's team", () => {
    const drummers = [user("d1", ["DRUMS"], false, "team-b")];
    const set: SchedulerSet = { ...tuesdaySet, teamId: "team-a" };
    expect(buildSchedule([set], drummers, [])).toHaveLength(0);
  });

  it("treats a team-less set as open to anyone who plays the role on any team", () => {
    // No teamId on the set → the union of the person's per-team roles is used.
    const drummers = [user("d1", ["DRUMS"], false, "some-team")];
    const result = buildSchedule([tuesdaySet], drummers, []);
    expect(result).toHaveLength(1);
  });

  it("is deterministic for identical inputs", () => {
    const users = ["a", "b", "c", "d"].map((id) => user(id, ["VOCALS"]));
    const first = buildSchedule([tuesdaySet], users, []);
    const second = buildSchedule([tuesdaySet], users, []);
    expect(first).toEqual(second);
  });

  it("seats an MD on a required-MD set, overriding load-balancing", () => {
    // b1 is an MD (on bass, an MD-eligible role) but already heavily loaded; b2
    // is a fresh non-MD bassist. Pure balancing would pick b2 — the MD
    // reservation must seat b1 instead.
    const bassists = [user("b1", ["BASS"], true), user("b2", ["BASS"])];
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    const result = buildSchedule([set], bassists, [], new Map([["b1", 5]]));
    const bass = result.filter((a) => a.role === "BASS");
    expect(bass).toEqual([{ setId: "set-1", userId: "b1", role: "BASS" }]);
  });

  it("only seats a required-MD set's MD in an MD-eligible role (not drums)", () => {
    // m1 is an MD who plays DRUMS and BASS; the reservation must seat them on
    // bass (MD-eligible), leaving drums to the non-MD drummer.
    const md = user("m1", ["DRUMS", "BASS"], true);
    const drummer = user("d2", ["DRUMS"]);
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    const result = buildSchedule([set], [md, drummer], [], new Map([["m1", 5]]));
    expect(result).toContainEqual({ setId: "set-1", userId: "m1", role: "BASS" });
    expect(result).toContainEqual({ setId: "set-1", userId: "d2", role: "DRUMS" });
  });

  it("leaves a required-MD set unled when the only MD plays no MD-eligible role", () => {
    // m1 is flagged MD but only plays DRUMS (not keys/electric/bass), so can't
    // lead. Drums still fills via the normal pass, but no MD-role slot is used.
    const md = user("m1", ["DRUMS"], true);
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    const result = buildSchedule([set], [md], []);
    expect(result.filter((a) => a.role === "DRUMS")).toHaveLength(1);
    expect(
      result.some((a) => ["KEYS", "ELECTRIC_GUITAR", "BASS"].includes(a.role))
    ).toBe(false);
  });

  it("lets an MD fill a role on a set that doesn't add an MD", () => {
    // MDs are ordinary players now — requiresMD off no longer bars them. b1
    // (an MD) is less loaded than b2, so normal balancing seats b1.
    const bassists = [user("b1", ["BASS"], true), user("b2", ["BASS"])];
    const result = buildSchedule([tuesdaySet], bassists, [], new Map([["b2", 5]]));
    expect(result).toEqual([{ setId: "set-1", userId: "b1", role: "BASS" }]);
  });

  it("fills a slot with an MD candidate even when the set adds no MD", () => {
    // The sole bassist is an MD; being an MD no longer excludes them, so the
    // bass slot is filled rather than left empty.
    const result = buildSchedule([tuesdaySet], [user("m1", ["BASS"], true)], []);
    expect(result).toContainEqual({ setId: "set-1", userId: "m1", role: "BASS" });
  });

  it("gracefully leaves a required-MD set with no MD when none is available", () => {
    // No MDs in the pool: the set still fills normally rather than blocking.
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    const result = buildSchedule([set], drummers, []);
    expect(result.filter((a) => a.role === "DRUMS")).toHaveLength(1);
  });

  it("never seats the MD twice on one required-MD set", () => {
    // A single MD who could fill several roles should still take just one slot.
    const md = user("m1", ["WORSHIP_LEADER", "KEYS", "DRUMS"], true);
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    const result = buildSchedule([set], [md], []);
    expect(result).toHaveLength(1);
  });

  // ── preAssigned: hand-picked slots the fill must work around ──────────────

  it("pre-assigned slots consume capacity (only the open drum slot is filled)", () => {
    // Drums capacity is 1 and d1 already holds it → no drum proposals at all.
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const set: SchedulerSet = {
      ...tuesdaySet,
      preAssigned: [{ userId: "d1", role: "DRUMS" }],
    };
    const result = buildSchedule([set], drummers, []);
    expect(result.some((a) => a.role === "DRUMS")).toBe(false);
  });

  it("fills the remaining capacity of a partially pre-assigned role", () => {
    // 4 vocal slots, 2 already taken → exactly 2 more proposed.
    const vocalists = ["v1", "v2", "v3", "v4", "v5"].map((id) =>
      user(id, ["VOCALS"])
    );
    const set: SchedulerSet = {
      ...tuesdaySet,
      preAssigned: [
        { userId: "v1", role: "VOCALS" },
        { userId: "v2", role: "VOCALS" },
      ],
    };
    const result = buildSchedule([set], vocalists, []);
    const vocals = result.filter((a) => a.role === "VOCALS");
    expect(vocals).toHaveLength(SLOT_CAPACITIES.VOCALS - 2);
    // The pre-assigned people are never re-proposed.
    expect(vocals.some((a) => ["v1", "v2"].includes(a.userId))).toBe(false);
  });

  it("never proposes a pre-assigned person for a second role", () => {
    // m1 drums this set already; even though they also play keys, the keys
    // slot must go to someone else (or stay empty).
    const multi = user("m1", ["DRUMS", "KEYS"]);
    const set: SchedulerSet = {
      ...tuesdaySet,
      preAssigned: [{ userId: "m1", role: "DRUMS" }],
    };
    const result = buildSchedule([set], [multi], []);
    expect(result).toHaveLength(0);
  });

  it("a pre-assigned MD in an MD role satisfies requiresMD (no second MD reserved)", () => {
    // m1 (MD) already sits on keys → the reservation must NOT seat m2 (also an
    // MD) ahead of the less-loaded non-MD bassist.
    const users = [
      user("m1", ["KEYS"], true),
      user("m2", ["BASS"], true),
      user("b1", ["BASS"]),
    ];
    const set: SchedulerSet = {
      ...tuesdaySet,
      requiresMD: true,
      preAssigned: [{ userId: "m1", role: "KEYS", isMD: true }],
    };
    const result = buildSchedule([set], users, [], new Map([["m2", 5]]));
    const bass = result.filter((a) => a.role === "BASS");
    expect(bass[0]).toEqual({ setId: "set-1", userId: "b1", role: "BASS" });
  });

  it("still reserves an MD when the pre-assigned MD sits in a non-MD role", () => {
    // m1 is an MD but pre-assigned to DRUMS (not MD-eligible) → the set still
    // needs a real MD seat, so m2 gets reserved on bass despite their load.
    const users = [user("m2", ["BASS"], true), user("b1", ["BASS"])];
    const set: SchedulerSet = {
      ...tuesdaySet,
      requiresMD: true,
      preAssigned: [{ userId: "m1", role: "DRUMS", isMD: true }],
    };
    const result = buildSchedule([set], users, [], new Map([["m2", 5]]));
    expect(result).toContainEqual({ setId: "set-1", userId: "m2", role: "BASS" });
  });

  it("tolerates a role pre-assigned beyond its capacity (no negative fill)", () => {
    // Two drummers already on a 1-capacity role (e.g. capacity was lowered
    // after they were assigned) — the fill must not add more or blow up.
    const drummers = [user("d3", ["DRUMS"])];
    const set: SchedulerSet = {
      ...tuesdaySet,
      preAssigned: [
        { userId: "d1", role: "DRUMS" },
        { userId: "d2", role: "DRUMS" },
      ],
    };
    const result = buildSchedule([set], drummers, []);
    expect(result.some((a) => a.role === "DRUMS")).toBe(false);
  });
});

// ── Spacing: prefer people who haven't served within the past week ────────
describe("buildSchedule spacing", () => {
  // A weekly Tuesday-7pm series starting Jan 6 2026, `n` sets long.
  function weeklySets(n: number): SchedulerSet[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `week-${i + 1}`,
      startsAt: new Date(2026, 0, 6 + 7 * i, 19, 0),
      durationMinutes: 60,
    }));
  }
  const who = (result: { setId: string; userId: string }[], setId: string) =>
    result.filter((a) => a.setId === setId).map((a) => a.userId);

  it("spacing beats load-balancing: no two weeks in a row when someone else can play", () => {
    // d2 carries 5 prior sets, so pure balancing would give d1 BOTH weeks.
    // Spacing hands week 2 to d2 anyway — d1 just played.
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(weeklySets(2), drummers, [], new Map([["d2", 5]]));
    expect(who(result, "week-1")).toEqual(["d1"]);
    expect(who(result, "week-2")).toEqual(["d2"]);
  });

  it("rotates a weekly set round-robin when everyone is available", () => {
    const drummers = ["d1", "d2", "d3"].map((id) => user(id, ["DRUMS"]));
    const result = buildSchedule(weeklySets(6), drummers, []);
    const order = weeklySets(6).map((s) => who(result, s.id)[0]);
    // Six weeks, three drummers → each plays twice, never twice in a row.
    expect(order).toEqual(["d1", "d2", "d3", "d1", "d2", "d3"]);
  });

  it("is soft: a lone candidate still fills back-to-back weeks", () => {
    const result = buildSchedule(weeklySets(2), [user("d1", ["DRUMS"])], []);
    expect(who(result, "week-1")).toEqual(["d1"]);
    expect(who(result, "week-2")).toEqual(["d1"]);
  });

  it("avoids someone already booked the day before (Thursday → Friday case)", () => {
    // d1 is on an existing Thursday set; the new Friday set should prefer d2
    // even though d2 is more loaded overall.
    const fridaySet: SchedulerSet = {
      id: "friday",
      startsAt: new Date(2026, 0, 9, 19, 0),
      durationMinutes: 60,
    };
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(
      [fridaySet],
      drummers,
      [],
      new Map([["d2", 3]]),
      [{ userId: "d1", startsAt: new Date(2026, 0, 8, 15, 0) }]
    );
    expect(result).toEqual([{ setId: "friday", userId: "d2", role: "DRUMS" }]);
  });

  it("still books the nearby-booked person when nobody else plays the role", () => {
    const fridaySet: SchedulerSet = {
      id: "friday",
      startsAt: new Date(2026, 0, 9, 19, 0),
      durationMinutes: 60,
    };
    const result = buildSchedule(
      [fridaySet],
      [user("d1", ["DRUMS"])],
      [],
      new Map(),
      [{ userId: "d1", startsAt: new Date(2026, 0, 8, 15, 0) }]
    );
    expect(result).toEqual([{ setId: "friday", userId: "d1", role: "DRUMS" }]);
  });

  it("a booking 8+ days away carries no penalty (load balancing decides)", () => {
    // d1 played 8 days before the set (outside MIN_GAP_DAYS) and has the lower
    // count → d1 wins despite the old booking.
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(
      [tuesdaySet], // Jan 6 2026
      drummers,
      [],
      new Map([["d2", 1]]),
      [{ userId: "d1", startsAt: new Date(2025, 11, 29, 19, 0) }] // Dec 29
    );
    expect(result).toEqual([{ setId: "set-1", userId: "d1", role: "DRUMS" }]);
  });

  it("the MD reservation prefers the MD who didn't just serve", () => {
    const mds = [user("m1", ["BASS"], true), user("m2", ["BASS"], true)];
    const set: SchedulerSet = { ...tuesdaySet, requiresMD: true };
    // m1 served yesterday → m2 gets the MD seat.
    const result = buildSchedule([set], mds, [], new Map(), [
      { userId: "m1", startsAt: new Date(2026, 0, 5, 19, 0) },
    ]);
    expect(result).toContainEqual({ setId: "set-1", userId: "m2", role: "BASS" });
  });

  it("pre-assigned people count for spacing on the surrounding sets", () => {
    // d1 is hand-picked onto week 1 → the week-2 fill should prefer d2 even
    // though d2 carries more prior sets.
    const [week1, week2] = weeklySets(2);
    const drummers = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = buildSchedule(
      [{ ...week1, preAssigned: [{ userId: "d1", role: "DRUMS" }] }, week2],
      drummers,
      [],
      new Map([["d2", 5]])
    );
    expect(who(result, "week-2")).toEqual(["d2"]);
  });

  it("fills CHOIR like any other counted role", () => {
    // Choir used to be skipped by the greedy fill (it was an unbounded list
    // seated separately). It's an ordinary slotted role now, so a set that
    // asks for choir seats gets them filled.
    const singer = user("c1", ["CHOIR"]);
    const result = buildSchedule(
      [{ ...tuesdaySet, capacities: { CHOIR: 1 } }],
      [singer],
      []
    );
    expect(result).toContainEqual({ setId: "set-1", userId: "c1", role: "CHOIR" });
  });

  it("treats a pre-assigned CHOIR slot as a constraint like any other role", () => {
    // Standing in a choir seat means you aren't also playing drums. (This is
    // the inverse of the old behaviour, which had to let choir members double
    // up because EVERY available singer was seated automatically.)
    const player = user("p1", ["DRUMS", "CHOIR"]);
    const result = buildSchedule(
      [{ ...tuesdaySet, preAssigned: [{ userId: "p1", role: "CHOIR" }] }],
      [player],
      []
    );
    expect(result).not.toContainEqual({
      setId: "set-1",
      userId: "p1",
      role: "DRUMS",
    });
  });
});

describe("availableGuestMembers", () => {
  // A guest seat draws on ANOTHER team's members — the generalization of what
  // the hardcoded choir fill used to do for one built-in key.
  const hostSet: SchedulerSet = { ...tuesdaySet, teamId: "team-host" };

  it("returns every available member who plays that role on the guest team", () => {
    const users = [
      user("c1", ["CHOIR"], false, "team-guest"),
      user("c2", ["VOCALS", "CHOIR"], false, "team-guest"),
      user("d1", ["DRUMS"], false, "team-guest"), // doesn't sing choir
    ];
    expect(
      availableGuestMembers(hostSet, "CHOIR", "team-guest", users, [])
    ).toEqual(["c1", "c2"]);
  });

  it("excludes people who are unavailable at the set's time", () => {
    const users = [
      user("c1", ["CHOIR"], false, "team-guest"),
      user("c2", ["CHOIR"], false, "team-guest"),
    ];
    const rules: UnavailabilityRule[] = [
      // c2 is blocked Tuesday evening.
      { userId: "c2", type: "RECURRING", dayOfWeek: 2, startMinute: 1080, endMinute: 1260 },
    ];
    expect(
      availableGuestMembers(hostSet, "CHOIR", "team-guest", users, rules)
    ).toEqual(["c1"]);
  });

  it("excludes anyone already on the set, in ANY seat", () => {
    // The point of the exclusion: someone playing keys for the host team is
    // busy, so the visiting choir must not also seat them.
    const users = [
      user("c1", ["CHOIR"], false, "team-guest"),
      user("c2", ["CHOIR"], false, "team-guest"),
    ];
    expect(
      availableGuestMembers(
        hostSet,
        "CHOIR",
        "team-guest",
        users,
        [],
        new Set(["c1"])
      )
    ).toEqual(["c2"]);
  });

  it("is scoped to the named guest team, not the set's own or any other", () => {
    const users = [
      user("c1", ["CHOIR"], false, "team-guest"),
      user("c2", ["CHOIR"], false, "team-other"), // different team → excluded
      user("c3", ["CHOIR"], false, "team-host"), // the host team → excluded
    ];
    expect(
      availableGuestMembers(hostSet, "CHOIR", "team-guest", users, [])
    ).toEqual(["c1"]);
  });

  it("orders least-booked first, so a capped guest role rotates", () => {
    const users = [
      user("c1", ["CHOIR"], false, "team-guest"),
      user("c2", ["CHOIR"], false, "team-guest"),
    ];
    // c1 has served twice recently, c2 once — c2 should come first.
    const loads = new Map([
      ["c1", 2],
      ["c2", 1],
    ]);
    expect(
      availableGuestMembers(
        hostSet,
        "CHOIR",
        "team-guest",
        users,
        [],
        new Set(),
        loads
      )
    ).toEqual(["c2", "c1"]);
  });
});

// ── Per-team balance ────────────────────────────────────────────────────────
// Overall load alone treats every set as interchangeable, so two people on two
// teams could end up owning one team's rotation each. The per-team tiebreak
// splits each team's sets between them instead.
describe("buildSchedule per-team balance", () => {
  // A drums-only shape, so nothing but the balancing rule decides who plays.
  const DRUMS_ONLY = Object.fromEntries(
    Object.keys(SLOT_CAPACITIES).map((role) => [role, role === "DRUMS" ? 1 : 0])
  );

  // Two teams, four weekly sets each: team A on Sundays, team B on the
  // Wednesday after — far enough apart that spacing doesn't pin the answer.
  function twoTeamSets(): SchedulerSet[] {
    const sets: SchedulerSet[] = [];
    for (let week = 0; week < 4; week++) {
      sets.push(
        {
          id: `a${week}`,
          startsAt: new Date(2026, 0, 4 + week * 7, 10, 0),
          durationMinutes: 60,
          teamId: "teamA",
          capacities: DRUMS_ONLY,
        },
        {
          id: `b${week}`,
          startsAt: new Date(2026, 0, 7 + week * 7, 19, 0),
          durationMinutes: 60,
          teamId: "teamB",
          capacities: DRUMS_ONLY,
        }
      );
    }
    return sets;
  }

  // Both people play drums on both teams.
  const bothTeams = (id: string) => user(id, ["DRUMS"], false, ["teamA", "teamB"]);
  const countOn = (
    result: { setId: string; userId: string }[],
    team: string,
    userId: string
  ) => result.filter((x) => x.setId.startsWith(team) && x.userId === userId).length;

  it("splits each team's sets between people who are on both", () => {
    const result = buildSchedule(
      twoTeamSets(),
      [bothTeams("p"), bothTeams("q")],
      []
    );
    for (const team of ["a", "b"]) {
      for (const person of ["p", "q"]) {
        expect(countOn(result, team, person), `${person} on ${team}`).toBe(2);
      }
    }
  });

  it("seeds from the caller's existing per-team counts", () => {
    // p has already done three of team A's sets in the db, so team A's slots
    // should now favour q even though the two are level overall.
    const result = buildSchedule(
      twoTeamSets(),
      [bothTeams("p"), bothTeams("q")],
      [],
      new Map(),
      [],
      new Map([[teamKey("p", "teamA"), 3]])
    );
    expect(countOn(result, "a", "q")).toBeGreaterThan(countOn(result, "a", "p"));
  });
});
