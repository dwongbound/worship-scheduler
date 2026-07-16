// Unit tests for the staged-plan helpers that power the "Review generated
// schedule" modal (lib/stagedPlan.ts): load counts and availability conflicts.
import { describe, expect, it } from "vitest";
import {
  conflictedUserIds,
  countAssignments,
  loadRows,
  maxLoad,
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

  it("reports the peak load (for scaling the bars)", () => {
    expect(maxLoad(sets)).toBe(3);
  });

  it("returns empty/zero for a plan with no assignments", () => {
    const empty = [stagedSet(week1, [])];
    expect(countAssignments(empty).size).toBe(0);
    expect(loadRows(empty)).toEqual([]);
    expect(maxLoad(empty)).toBe(0);
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
  function ru(id: string, instruments: Instrument[]) {
    return { id, instruments };
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
      KEYS: 1, STRINGS: 0, DRUMS: 0, BASS: 0,
    } as Record<Instrument, number>;
    const set: StagedSet = {
      ...stagedSet(week1, [{ userId: "k", role: "KEYS" }]),
      slotCapacities: onlyKeys,
    };
    expect(unfillableRoles(set, [ru("k", ["KEYS"])], []).size).toBe(0);
  });

  it("totals unfillable roles across the whole plan", () => {
    const sets = [stagedSet(week1, []), stagedSet(week2, [])];
    // Each set is missing keys → 2 total.
    expect(totalUnfillable(sets, rosterMinusKeys, [])).toBe(2);
  });
});
