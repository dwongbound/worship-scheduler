// planFixedSets (lib/stagedPlan.ts): merging the server's snapshot of the sets
// around a plan with the plan's OWN sets as they now stand, which is what a
// SAME_PLAYER rule reads partner rosters out of.
import { describe, expect, it } from "vitest";
import { planFixedSets } from "@/lib/stagedPlan";
import { buildSchedule, type FixedSet, type SchedulerUser } from "@/lib/scheduler";
import type { SchedulingRule } from "@/lib/schedulingRules";
import type { StagedSet } from "@/lib/types";

const SAT = new Date(2026, 0, 10, 19, 0);
const SUN = new Date(2026, 0, 11, 9, 0);

function staged(
  startsAt: Date,
  assignments: StagedSet["assignments"],
  extra: Partial<StagedSet> = {}
): StagedSet {
  return {
    startsAt: startsAt.toISOString(),
    label: "Set",
    durationMinutes: 60,
    requiresMD: false,
    mdUserId: null,
    slotCapacities: null,
    existing: true,
    assignments,
    ...extra,
  };
}

describe("planFixedSets", () => {
  it("keeps baseline sets that aren't in the plan", () => {
    const baseline: FixedSet[] = [
      { setId: "other", templateId: "t", startsAt: SAT, assignments: [] },
    ];
    const merged = planFixedSets(baseline, [staged(SUN, [], { setId: "sun" })]);
    expect(merged.map((f) => f.setId).sort()).toEqual(["other", "sun"]);
  });

  it("drops the baseline's stale copy of a set the plan also holds", () => {
    // The server snapshot says d1 plays Saturday; the plan has since staged d2.
    const baseline: FixedSet[] = [
      {
        setId: "sat",
        templateId: "sat-tpl",
        startsAt: SAT,
        assignments: [{ userId: "d1", role: "DRUMS" }],
      },
    ];
    const merged = planFixedSets(baseline, [
      staged(SAT, [{ userId: "d2", role: "DRUMS" }], {
        setId: "sat",
        templateId: "sat-tpl",
      }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].assignments).toEqual([{ userId: "d2", role: "DRUMS" }]);
  });

  it("matches Preview Mode's sets, which carry their id as stagingId", () => {
    const baseline: FixedSet[] = [
      { setId: "sat", templateId: null, startsAt: SAT, assignments: [] },
    ];
    const merged = planFixedSets(baseline, [
      staged(SAT, [{ userId: "d2", role: "DRUMS" }], { stagingId: "sat" }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].assignments).toEqual([{ userId: "d2", role: "DRUMS" }]);
  });

  it("omits the set being re-filled — it's the run's subject, not a fixed roster", () => {
    const sets = [
      staged(SAT, [], { setId: "sat" }),
      staged(SUN, [], { setId: "sun" }),
    ];
    expect(planFixedSets([], sets, 1).map((f) => f.setId)).toEqual(["sat"]);
  });

  it("leaves a brand-new set (no db row yet) in, keyed only by its template", () => {
    const merged = planFixedSets([], [staged(SUN, [], { templateId: "sun-tpl" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0].setId).toBeNull();
    expect(merged[0].templateId).toBe("sun-tpl");
  });
});

// The reason the merge exists, end to end: a required SAME_PLAYER rule must owe
// Sunday's seat to whoever plays Saturday NOW, not to whoever the server
// snapshot still remembers.
describe("a required SAME_PLAYER rule reading the merged rosters", () => {
  const TEAM = "t1";
  const player = (id: string): SchedulerUser => ({
    id,
    rolesByTeam: { [TEAM]: ["DRUMS"] },
  });
  const rule: SchedulingRule = {
    id: "r1",
    tier: "REQUIRED",
    enabled: true,
    params: {
      kind: "SAME_PLAYER",
      scope: "WEEKLY",
      role: "DRUMS",
      templateIds: ["sat-tpl", "sun-tpl"],
    },
  };
  // The stale server snapshot: d1 was Saturday's drummer when the plan opened.
  const baseline: FixedSet[] = [
    {
      setId: "sat",
      templateId: "sat-tpl",
      startsAt: SAT,
      assignments: [{ userId: "d1", role: "DRUMS" }],
    },
  ];
  // On screen, Saturday has been changed to d2 and Sunday is the open card.
  const sets = [
    staged(SAT, [{ userId: "d2", role: "DRUMS" }], {
      setId: "sat",
      templateId: "sat-tpl",
    }),
    staged(SUN, [], { setId: "sun", templateId: "sun-tpl" }),
  ];

  const fillSunday = (fixedSets: FixedSet[]) =>
    buildSchedule(
      [
        {
          id: "sun",
          setId: "sun",
          templateId: "sun-tpl",
          startsAt: SUN,
          durationMinutes: 60,
          teamId: TEAM,
          roles: [
            { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 0 },
          ],
        },
      ],
      [player("d1"), player("d2")],
      [],
      new Map(),
      [],
      new Map(),
      { schedulingRules: [rule], fixedSets }
    ).map((p) => p.userId);

  it("seats the staged player, not the snapshot's", () => {
    expect(fillSunday(planFixedSets(baseline, sets, 1))).toEqual(["d2"]);
  });

  it("would have seated the stale one without the merge", () => {
    // Both copies present — the rule owes the seat to either, and the stale
    // player wins it. This is the bug the merge exists to prevent.
    const unmerged: FixedSet[] = [
      {
        setId: "sat",
        templateId: "sat-tpl",
        startsAt: SAT,
        assignments: [{ userId: "d2", role: "DRUMS" }],
      },
      ...baseline,
    ];
    expect(fillSunday(unmerged)).toEqual(["d1"]);
  });
});
