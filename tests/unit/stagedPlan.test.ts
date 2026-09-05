// Unit tests for the staged-plan helpers that power the "Review generated
// schedule" modal (lib/stagedPlan.ts): load counts and availability conflicts.
import { describe, expect, it } from "vitest";
import {
  conflictedUserIds,
  isActiveForSet,
  countAssignments,
  loadRows,
  lockedCounts,
  maxLoad,
  totalLocked,
  totalConflicts,
  totalUnfillable,
  unfillableRoles,
} from "@/lib/stagedPlan";
import type { UnavailabilityRule } from "@/lib/scheduler";
import type { Instrument } from "@/lib/constants";
import type { StagedSet } from "@/lib/types";

// A minimal staged set builder — only the fields the helpers read matter.
function stagedSet(
  startsAt: string,
  assignments: StagedSet["assignments"],
  durationMinutes = 60
): StagedSet {
  return {
    startsAt,
    label: "Set",
    durationMinutes,
    requiresMD: false,
    mdUserId: null,
    slotCapacities: null,
    existing: false,
    assignments,
  };
}

// Two Tuesday-evening sets a week apart, 7pm local.
const week1 = "2026-01-06T19:00:00"; // Tue Jan 6 2026
const week2 = "2026-01-13T19:00:00"; // Tue Jan 13 2026

describe("lockedCounts / totalLocked", () => {
  // Only the hand-picked (locked) slots count — the auto-filled ones are the
  // ones a re-run is allowed to re-roll.
  const sets = [
    stagedSet(week1, [
      { userId: "a", role: "DRUMS", locked: true },
      { userId: "b", role: "BASS" },
      { userId: "a", role: "KEYS", locked: true },
    ]),
    stagedSet(week2, [
      { userId: "a", role: "DRUMS", locked: true },
      { userId: "c", role: "BASS" },
    ]),
  ];

  it("tallies locked slots per user", () => {
    expect(lockedCounts(sets)).toEqual(new Map([["a", 3]]));
  });

  it("totals the locked slots across the plan", () => {
    expect(totalLocked(sets)).toBe(3);
  });

  it("is zero for a plan nobody has touched", () => {
    const untouched = [stagedSet(week1, [{ userId: "a", role: "DRUMS" }])];
    expect(lockedCounts(untouched).size).toBe(0);
    expect(totalLocked(untouched)).toBe(0);
  });
});

describe("countAssignments / loadRows / maxLoad", () => {
  const sets = [
    stagedSet(week1, [
      { userId: "a", role: "DRUMS" },
      { userId: "b", role: "BASS" },
      { userId: "a", role: "KEYS" }, // 'a' fills two roles on this set
    ]),
    stagedSet(week2, [
      { userId: "a", role: "DRUMS" },
      { userId: "c", role: "BASS" },
    ]),
  ];

  it("counts every slot a user holds across all sets", () => {
    const counts = countAssignments(sets);
    expect(counts.get("a")).toBe(3);
    expect(counts.get("b")).toBe(1);
    expect(counts.get("c")).toBe(1);
  });

  it("orders load rows busiest-first, ties broken on id", () => {
    expect(loadRows(sets)).toEqual([
      { userId: "a", count: 3 },
      { userId: "b", count: 1 },
      { userId: "c", count: 1 },
    ]);
  });

  it("measures rows by `by` when given, keeping the plan's own tally", () => {
    // The panel showing e.g. "past 6 months": the people are still the plan's,
    // but the number (and the order) comes from the other tally. Someone with
    // no history at all still shows, at 0.
    const by = new Map([
      ["b", 9],
      ["a", 2],
    ]);
    expect(loadRows(sets, by)).toEqual([
      { userId: "b", count: 9 },
      { userId: "a", count: 2 },
      { userId: "c", count: 0 },
    ]);
  });

  it("reports the peak load (for scaling the bars)", () => {
    expect(maxLoad(loadRows(sets))).toBe(3);
    // Scales to whatever the rows were measured with, not the plan.
    expect(maxLoad(loadRows(sets, new Map([["b", 9]])))).toBe(9);
  });

  it("returns empty/zero for a plan with no assignments", () => {
    const empty = [stagedSet(week1, [])];
    expect(countAssignments(empty).size).toBe(0);
    expect(loadRows(empty)).toEqual([]);
    expect(maxLoad(loadRows(empty))).toBe(0);
  });
});

describe("conflictedUserIds / totalConflicts", () => {
  // 'a' is out every Tuesday evening; 'b' is always free.
  const rules: UnavailabilityRule[] = [
    { userId: "a", type: "RECURRING", dayOfWeek: 2, startMinute: 1080, endMinute: 1260 },
  ];

  it("flags an assigned user who is unavailable at the set's time", () => {
    const set = stagedSet(week1, [
      { userId: "a", role: "DRUMS" },
      { userId: "b", role: "BASS" },
    ]);
    const bad = conflictedUserIds(set, rules);
    expect(bad.has("a")).toBe(true);
    expect(bad.has("b")).toBe(false);
  });

  it("finds no conflict when everyone is free", () => {
    const set = stagedSet(week1, [{ userId: "b", role: "BASS" }]);
    expect(conflictedUserIds(set, rules).size).toBe(0);
  });

  it("totals conflicts across the whole plan (per slot)", () => {
    const sets = [
      stagedSet(week1, [
        { userId: "a", role: "DRUMS" }, // conflict
        { userId: "b", role: "BASS" },
      ]),
      stagedSet(week2, [
        { userId: "a", role: "DRUMS" }, // conflict again the next week
      ]),
    ];
    expect(totalConflicts(sets, rules)).toBe(2);
  });

  it("has no conflicts when there are no rules", () => {
    const set = stagedSet(week1, [{ userId: "a", role: "DRUMS" }]);
    expect(totalConflicts([set], [])).toBe(0);
  });
});

describe("unfillableRoles / totalUnfillable", () => {
  // Roles are per-team; these staged sets are team-less, so a role on any team
  // counts (playsRoleForSet unions across teams for a team-less set).
  function ru(id: string, roles: Instrument[]) {
    return { id, teams: [{ id: "team-default", roles }] };
  }
  // One player for every default role EXCEPT keys — so keys is the only role
  // with no candidate to fill it.
  const rosterMinusKeys = [
    ru("wl", ["WORSHIP_LEADER"]),
    ru("dr", ["DRUMS"]),
    ru("ba", ["BASS"]),
    ru("ac", ["ACOUSTIC_GUITAR"]),
    ru("el", ["ELECTRIC_GUITAR"]),
    ru("st", ["STRINGS"]),
    ru("vo", ["VOCALS"]),
    ru("av", ["AV"]),
  ];

  it("flags a role no one plays", () => {
    const set = stagedSet(week1, []); // empty roster, default capacities
    expect(unfillableRoles(set, rosterMinusKeys, [])).toEqual(
      new Set(["KEYS"])
    );
  });

  it("flags a role whose only candidate is unavailable at that time", () => {
    // Add a keys player, but block them every Tuesday evening.
    const roster = [...rosterMinusKeys, ru("k", ["KEYS"])];
    const rules: UnavailabilityRule[] = [
      { userId: "k", type: "RECURRING", dayOfWeek: 2, startMinute: 1080, endMinute: 1260 },
    ];
    const set = stagedSet(week1, []);
    expect(unfillableRoles(set, roster, rules).has("KEYS")).toBe(true);
  });

  it("does not flag a role that has no open slot", () => {
    // A set that wants ONLY keys (1 slot), already filled → nothing unfillable
    // even though no other keys player exists.
    const onlyKeys = {
      WORSHIP_LEADER: 0, VOCALS: 0, ACOUSTIC_GUITAR: 0, ELECTRIC_GUITAR: 0,
      KEYS: 1, STRINGS: 0, DRUMS: 0, BASS: 0, AV: 0,
    } as Record<Instrument, number>;
    const set: StagedSet = {
      ...stagedSet(week1, [{ userId: "k", role: "KEYS" }]),
      slotCapacities: onlyKeys,
    };
    expect(unfillableRoles(set, [ru("k", ["KEYS"])], []).size).toBe(0);
  });

  it("flags a role whose only candidate is inactive on the team", () => {
    // A keys player who's been switched off: nothing will auto-fill the slot
    // with them, so the hole is still structural.
    const roster = [
      ...rosterMinusKeys,
      { id: "k", teams: [{ id: "team-default", roles: ["KEYS" as Instrument], active: false }] },
    ];
    expect(unfillableRoles(stagedSet(week1, []), roster, []).has("KEYS")).toBe(
      true
    );
  });

  it("totals unfillable roles across the whole plan", () => {
    const sets = [stagedSet(week1, []), stagedSet(week2, [])];
    // Each set is missing keys → 2 total.
    expect(totalUnfillable(sets, rosterMinusKeys, [])).toBe(2);
  });
});

describe("isActiveForSet", () => {
  const onTwo = {
    id: "u",
    teams: [
      { id: "t1", roles: ["KEYS" as Instrument], active: false },
      { id: "t2", roles: ["KEYS" as Instrument], active: true },
    ],
  };

  it("is per team — inactive on one, active on another", () => {
    expect(isActiveForSet(onTwo, "t1")).toBe(false);
    expect(isActiveForSet(onTwo, "t2")).toBe(true);
  });

  it("treats a membership with no flag as active (pre-flag data)", () => {
    expect(isActiveForSet({ id: "u", teams: [{ id: "t1", roles: [] }] }, "t1")).toBe(
      true
    );
  });

  it("counts a team-less set as active when ANY team is active", () => {
    expect(isActiveForSet(onTwo, null)).toBe(true);
    const allOff = {
      id: "u",
      teams: [{ id: "t1", roles: [] as Instrument[], active: false }],
    };
    expect(isActiveForSet(allOff, null)).toBe(false);
  });

  it("is active when the person isn't on the team at all (unknown ≠ paused)", () => {
    expect(isActiveForSet({ id: "u", teams: [] }, "t1")).toBe(true);
  });
});
