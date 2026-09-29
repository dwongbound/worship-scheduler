// Unit tests for the staged-plan helpers that power the "Review generated
// schedule" modal (lib/stagedPlan.ts): load counts and availability conflicts.
import { describe, expect, it } from "vitest";
import {
  conflictedUserIds,
  isActiveForSet,
  countAssignments,
  loadRows,
  lockedCounts,
  copySet,
  designateMDs,
  maxLoad,
  pasteSet,
  popUndo,
  previousMDForTeam,
  pushUndo,
  UNDO_DEPTH,
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

describe("previousMDForTeam", () => {
  // A led set, reduced to the three fields this helper reads.
  const led = (
    startsAt: string,
    mdUserId: string | null,
    teamId: string | null = "t1"
  ): StagedSet => ({ ...stagedSet(startsAt, []), mdUserId, teamId });

  it("returns the MD of the most recent earlier set on the same team", () => {
    const earlier = [led("2026-01-04", "alice"), led("2026-01-11", "bob")];
    expect(previousMDForTeam(earlier, "t1")).toBe("bob");
  });

  it("survives an empty prefix — the first set of a run has no predecessor", () => {
    // The regression: redesignateMDs decides set i with only sets 0..i-1
    // settled, so for i=0 it passes an EMPTY list. An earlier version indexed
    // the list by the current set's position and blew up here the moment
    // "Auto schedule all" was clicked.
    expect(previousMDForTeam([], "t1")).toBeNull();
  });

  it("reads the seed when no earlier set in the run led", () => {
    // Covers the plan's first set, whose real predecessor is a set from before
    // the window that the client never loaded.
    expect(previousMDForTeam([], "t1", { t1: "carol" })).toBe("carol");
    // An earlier set in the run outranks the seed.
    expect(previousMDForTeam([led("2026-01-04", "bob")], "t1", { t1: "carol" })).toBe(
      "bob"
    );
  });

  it("ignores other teams — two teams the same week rotate independently", () => {
    const earlier = [led("2026-01-04", "alice", "t1"), led("2026-01-04", "bob", "t2")];
    expect(previousMDForTeam(earlier, "t1")).toBe("alice");
    expect(previousMDForTeam(earlier, "t2")).toBe("bob");
  });

  it("treats a team-less set as its own rotation, seeded under \"\"", () => {
    const earlier = [led("2026-01-04", "alice", null)];
    expect(previousMDForTeam(earlier, null)).toBe("alice");
    expect(previousMDForTeam(earlier, "t1")).toBeNull();
    expect(previousMDForTeam([], undefined, { "": "dave" })).toBe("dave");
  });

  it("carries past a set nobody could lead rather than breaking the chain", () => {
    const earlier = [led("2026-01-04", "alice"), led("2026-01-11", null)];
    expect(previousMDForTeam(earlier, "t1")).toBe("alice");
  });
});

describe("designateMDs", () => {
  // Two electric guitarists who can both lead, on one team, week after week.
  const guitarists: StagedSet["assignments"] = [
    { userId: "alice", role: "ELECTRIC_GUITAR" as Instrument },
    { userId: "bob", role: "ELECTRIC_GUITAR" as Instrument },
  ];
  const led = (startsAt: string, teamId: string | null = "t1"): StagedSet => ({
    ...stagedSet(startsAt, guitarists),
    requiresMD: true,
    mdUserId: null,
    teamId,
  });
  const bothAreMDs = { isMD: (id: string) => id === "alice" || id === "bob" };

  it("doesn't give the same person two sets in a row", () => {
    // The behaviour the whole change exists for.
    const out = designateMDs(
      ["2026-01-04", "2026-01-11", "2026-01-18", "2026-01-25"].map((d) => led(d)),
      bothAreMDs
    );
    const mds = out.map((s) => s.mdUserId);
    expect(mds.every(Boolean)).toBe(true);
    for (let i = 1; i < mds.length; i++) expect(mds[i]).not.toBe(mds[i - 1]);
  });

  it("settles the FIRST set without crashing", () => {
    // The regression, at the layer that actually broke: set 0 is decided with
    // nothing settled before it. The old code indexed that empty prefix by the
    // current set's position and threw, taking the modal down with it.
    expect(() => designateMDs([led("2026-01-04")], bothAreMDs)).not.toThrow();
    expect(designateMDs([led("2026-01-04")], bothAreMDs)[0].mdUserId).toBe("alice");
  });

  it("starts the rotation from the seed, so set one doesn't repeat last week", () => {
    const out = designateMDs([led("2026-01-04")], {
      ...bothAreMDs,
      seed: { t1: "alice" },
    });
    expect(out[0].mdUserId).toBe("bob");
  });

  it("rotates each team independently", () => {
    const out = designateMDs(
      [led("2026-01-04", "t1"), led("2026-01-04", "t2"), led("2026-01-11", "t1")],
      bothAreMDs
    );
    // t1 alternates across ITS OWN two sets; t2's single set is unaffected by
    // t1 having just picked someone.
    expect(out[0].mdUserId).toBe("alice");
    expect(out[1].mdUserId).toBe("alice");
    expect(out[2].mdUserId).toBe("bob");
  });

  it("keeps a still-valid pick and clears MDs on sets that don't want one", () => {
    const kept: StagedSet = { ...led("2026-01-04"), mdUserId: "bob" };
    const noMD: StagedSet = { ...led("2026-01-11"), requiresMD: false, mdUserId: "alice" };
    const out = designateMDs([kept, noMD], bothAreMDs);
    expect(out[0].mdUserId).toBe("bob");
    expect(out[1].mdUserId).toBeNull();
  });

  it("leaves mdUserId null when nobody on the roster can lead", () => {
    const out = designateMDs([led("2026-01-04")], { isMD: () => false });
    expect(out[0].mdUserId).toBeNull();
  });
});

describe("copySet / pasteSet", () => {
  const source: StagedSet = {
    ...stagedSet("2026-01-04", [
      { userId: "alice", role: "KEYS" as Instrument },
      { userId: "bob", role: "DRUMS" as Instrument },
    ]),
    teamId: "t1",
    label: "Source",
  };
  const capacities = { KEYS: 1, DRUMS: 1, BASS: 0 };

  it("carries the resolved shape and the people, not the stored override", () => {
    const clip = copySet(source, capacities);
    expect(clip.capacities).toEqual(capacities);
    expect(clip.assignments).toEqual([
      { userId: "alice", role: "KEYS" },
      { userId: "bob", role: "DRUMS" },
    ]);
  });

  it("doesn't alias the source — editing the copy can't reach back", () => {
    const clip = copySet(source, capacities);
    clip.capacities.KEYS = 99;
    expect(capacities.KEYS).toBe(1);
  });

  it("gives the target the source's shape, including roles it didn't have", () => {
    const target: StagedSet = {
      ...stagedSet("2026-01-11", [{ userId: "carol", role: "VOCALS" as Instrument }]),
      teamId: "t2",
      label: "Target",
      slotCapacities: { VOCALS: 2 },
    };
    const pasted = pasteSet(target, copySet(source, capacities));

    // Its own identity survives...
    expect(pasted.startsAt).toBe("2026-01-11");
    expect(pasted.label).toBe("Target");
    expect(pasted.teamId).toBe("t2");
    // ...and it takes the source's form: the source's roles, and none of the
    // ones only the target had.
    expect(pasted.slotCapacities).toEqual(capacities);
    expect(pasted.assignments.map((a) => a.userId)).toEqual(["alice", "bob"]);
    expect(pasted.assignments.some((a) => a.role === "VOCALS")).toBe(false);
  });

  it("locks every pasted seat", () => {
    // Pasting is a deliberate statement about who plays, so a later auto
    // schedule has to treat it as a constraint rather than overwrite it.
    const pasted = pasteSet(stagedSet("2026-01-11", []), copySet(source, capacities));
    expect(pasted.assignments.every((a) => a.locked)).toBe(true);
  });

  it("keeps the assignmentId of a seat the target already had", () => {
    // Same person, same role = the same seat, so Preview Mode saves it as an
    // update and it keeps its history instead of being deleted and re-added.
    const target: StagedSet = {
      ...stagedSet("2026-01-11", [
        { userId: "alice", role: "KEYS" as Instrument, assignmentId: "a1" },
        { userId: "zoe", role: "DRUMS" as Instrument, assignmentId: "a2" },
      ]),
      teamId: "t1",
    };
    const pasted = pasteSet(target, copySet(source, capacities));
    expect(pasted.assignments.find((a) => a.userId === "alice")?.assignmentId).toBe("a1");
    // bob is new to this set, so he's a new seat rather than inheriting zoe's.
    expect(pasted.assignments.find((a) => a.userId === "bob")?.assignmentId).toBeUndefined();
  });

  it("clears the target's MD, since the roster it belonged to is gone", () => {
    const target: StagedSet = {
      ...stagedSet("2026-01-11", []),
      requiresMD: true,
      mdUserId: "someone-not-pasted",
    };
    expect(pasteSet(target, copySet(source, capacities)).mdUserId).toBeNull();
  });
});

describe("pushUndo / popUndo", () => {
  // The helpers only ever compare set lists by REFERENCE, so the contents of
  // these are irrelevant — what matters is which array object is which.
  const planA: StagedSet[] = [stagedSet("2026-01-04", [])];
  const planB: StagedSet[] = [stagedSet("2026-01-11", [])];
  const planC: StagedSet[] = [stagedSet("2026-01-18", [])];

  it("records a paste without touching the stack it was given", () => {
    const stack = pushUndo([], { idx: 0, before: planA, after: planB });
    expect(stack).toHaveLength(1);
    expect(pushUndo(stack, { idx: 1, before: planB, after: planC })).toHaveLength(2);
    // The original is untouched — these feed a useState setter.
    expect(stack).toHaveLength(1);
  });

  it("drops the oldest entries past the depth cap", () => {
    let stack: ReturnType<typeof pushUndo> = [];
    for (let i = 0; i < UNDO_DEPTH + 5; i++) {
      stack = pushUndo(stack, { idx: i, before: planA, after: planB });
    }
    expect(stack).toHaveLength(UNDO_DEPTH);
    // The survivors are the most recent ones, so the newest paste is always
    // the one you can take back.
    expect(stack[stack.length - 1].idx).toBe(UNDO_DEPTH + 4);
    expect(stack[0].idx).toBe(5);
  });

  it("restores the plan as it stood before the last paste", () => {
    const stack = pushUndo([], { idx: 2, before: planA, after: planB });
    const undone = popUndo(stack, planB);
    expect(undone.ok).toBe(true);
    if (undone.ok) {
      expect(undone.sets).toBe(planA);
      expect(undone.idx).toBe(2);
      expect(undone.stack).toEqual([]);
    }
  });

  it("chains, because one paste's `before` is the previous one's `after`", () => {
    // planA --paste--> planB --paste--> planC, then two undos walk it back.
    let stack = pushUndo([], { idx: 0, before: planA, after: planB });
    stack = pushUndo(stack, { idx: 1, before: planB, after: planC });

    const first = popUndo(stack, planC);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.sets).toBe(planB);

    const second = popUndo(first.stack, first.sets);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.sets).toBe(planA);
  });

  it("does nothing, and keeps the stack, when there's nothing to undo", () => {
    const empty = popUndo([], planA);
    expect(empty.ok).toBe(false);
    expect(empty.stack).toEqual([]);
  });

  it("refuses and throws the history away once the plan has moved on", () => {
    // Someone edited a dropdown after the paste, so `sets` is a new array.
    // Rewinding here would silently discard that edit; the whole trail behind
    // it is untrustworthy too, so it goes.
    const stack = pushUndo([], { idx: 0, before: planA, after: planB });
    const stale = popUndo(stack, planC);
    expect(stale.ok).toBe(false);
    expect(stale.stack).toEqual([]);
  });

  it("is not fooled by a plan that merely LOOKS the same", () => {
    // A structurally identical copy is still a different edit — reference
    // equality is the point, not deep equality.
    const stack = pushUndo([], { idx: 0, before: planA, after: planB });
    expect(popUndo(stack, [...planB]).ok).toBe(false);
  });
});
