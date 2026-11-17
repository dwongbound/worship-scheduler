// Unit tests for ruleHeldRoles / totalRuleHeld (lib/stagedPlan.ts): which open
// slots a REQUIRED scheduling rule is what's holding empty, which is what the
// review workspace marks with a "!".
import { describe, expect, it } from "vitest";
import { ruleHeldRoles, totalRuleHeld } from "@/lib/stagedPlan";
import type { SchedulerUser } from "@/lib/scheduler";
import type { RuleParams, RuleTier, SchedulingRule } from "@/lib/schedulingRules";
import type { TeamRoleDef } from "@/lib/teamRoles";
import type { StagedSet } from "@/lib/types";

const TEAM = "team-1";

// One drums slot and one bass slot, so each test reads as "who got THAT seat".
const CATALOG: TeamRoleDef[] = [
  { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 0 },
  { key: "BASS", label: "Bass", defaultCount: 1, adminOnly: false, order: 1 },
];

function player(id: string, roles: string[]): SchedulerUser {
  return { id, rolesByTeam: { [TEAM]: roles } };
}

let n = 0;
function rule(params: RuleParams, tier: RuleTier = "REQUIRED", enabled = true): SchedulingRule {
  return { id: `r${++n}`, tier, enabled, params };
}

// Sat 10 Jan / Sun 11 Jan 2026 — one Mon–Sun week, so a WEEKLY SAME_PLAYER
// rule pairs them.
const SAT = new Date(2026, 0, 10, 19, 0).toISOString();
const SUN = new Date(2026, 0, 11, 9, 0).toISOString();

function stagedSet(
  startsAt: string,
  assignments: StagedSet["assignments"] = [],
  extra: Partial<StagedSet> = {}
): StagedSet {
  return {
    startsAt,
    label: "Set",
    durationMinutes: 60,
    requiresMD: false,
    mdUserId: null,
    slotCapacities: null,
    existing: false,
    teamId: TEAM,
    assignments,
    ...extra,
  };
}

describe("ruleHeldRoles", () => {
  it("is empty when the org has no rules at all", () => {
    const held = ruleHeldRoles(
      stagedSet(SUN),
      [player("d1", ["DRUMS"])],
      [],
      CATALOG
    );
    expect([...held.keys()]).toEqual([]);
  });

  it("flags a seat a required SAME_PLAYER rule holds for someone who can't take it", () => {
    // Saturday's drummer is d1, and the weekly rule says Sunday's drummer must
    // be the same person — but d1 is blocked on Sunday morning, so the fill
    // leaves the seat open rather than handing it to d2.
    const rules = [
      rule({
        kind: "SAME_PLAYER",
        scope: "WEEKLY",
        role: "DRUMS",
        templateIds: ["sat-tpl", "sun-tpl"],
      }),
    ];
    const held = ruleHeldRoles(
      stagedSet(SUN, [], { templateId: "sun-tpl" }),
      [player("d1", ["DRUMS"]), player("d2", ["DRUMS"])],
      [
        {
          userId: "d1",
          type: "SPECIFIC",
          startDate: new Date(2026, 0, 11),
          startMinute: 0,
          endMinute: 24 * 60,
        },
      ],
      CATALOG,
      {
        schedulingRules: rules,
        fixedSets: [
          {
            setId: "sat",
            templateId: "sat-tpl",
            startsAt: new Date(SAT),
            assignments: [{ userId: "d1", role: "DRUMS" }],
          },
        ],
      }
    );
    expect([...held.keys()]).toEqual(["DRUMS"]);
    // And says WHICH rule, which is what the tooltip shows.
    expect(held.get("DRUMS")).toEqual(rules);
  });

  it("flags a role whose every candidate a required NEVER rule refuses", () => {
    // v1 is already on the set; the only drummer never serves alongside them.
    const rules = [rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] })];
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect([...held.keys()]).toEqual(["DRUMS"]);
  });

  it("flags a role whose only candidate is over a required LIMIT", () => {
    const rules = [rule({ kind: "LIMIT", userId: "d1", max: 1, period: "WEEK" })];
    const held = ruleHeldRoles(
      stagedSet(SUN),
      [player("d1", ["DRUMS"])],
      [],
      CATALOG,
      {
        schedulingRules: rules,
        // Already booked on the Saturday of the same Mon–Sun week.
        periodBookings: [{ userId: "d1", startsAt: new Date(SAT) }],
      }
    );
    expect([...held.keys()]).toEqual(["DRUMS"]);
  });

  it("ignores a rule the admin switched off", () => {
    const rules = [
      rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] }, "REQUIRED", false),
    ];
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect([...held.keys()]).toEqual([]);
  });

  it("ignores a PREFERENCE — it bends, so it never holds a seat open", () => {
    const rules = [
      rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] }, "PREFERENCE"),
    ];
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect([...held.keys()]).toEqual([]);
  });

  it("doesn't flag a role nobody can fill anyway — that's the red unfillable flag", () => {
    // No drummer exists at all, so the rules aren't what's keeping it empty.
    const rules = [rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "b1"] })];
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect(held.has("DRUMS")).toBe(false);
  });

  it("doesn't flag a role the rule still leaves someone for", () => {
    const rules = [rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] })];
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("d2", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect([...held.keys()]).toEqual([]);
  });

  it("doesn't flag a slot that's already filled", () => {
    const rules = [rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] })];
    const held = ruleHeldRoles(
      stagedSet(SUN, [
        { userId: "v1", role: "BASS" },
        { userId: "d2", role: "DRUMS" },
      ]),
      [player("d1", ["DRUMS"]), player("d2", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CATALOG,
      { schedulingRules: rules }
    );
    expect([...held.keys()]).toEqual([]);
  });
});

describe("totalRuleHeld", () => {
  const rules = [rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] })];
  const users = [player("d1", ["DRUMS"]), player("v1", ["BASS"])];
  const sets = [
    stagedSet(SAT, [{ userId: "v1", role: "BASS" }]),
    stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
  ];

  it("counts the held slots across every set in the plan", () => {
    expect(
      totalRuleHeld(sets, users, [], new Map([[TEAM, CATALOG]]), {
        schedulingRules: rules,
      })
    ).toBe(2);
  });

  it("is zero — without filling anything — when no required rule is active", () => {
    expect(totalRuleHeld(sets, users, [], new Map([[TEAM, CATALOG]]))).toBe(0);
  });
});

describe("which rule is holding it", () => {
  const CAT: TeamRoleDef[] = [
    { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 0 },
    { key: "BASS", label: "Bass", defaultCount: 1, adminOnly: false, order: 1 },
  ];

  it("names only the rule responsible, not every required rule", () => {
    // Two required rules: one bars the lone drummer, the other is about bass
    // and has nothing to do with the empty drums seat.
    const blocking = rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] });
    const unrelated = rule({ kind: "LIMIT", userId: "b1", max: 5, period: "WEEK" });
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("v1", ["BASS"]), player("b1", ["BASS"])],
      [],
      CAT,
      { schedulingRules: [blocking, unrelated] }
    );
    expect(held.get("DRUMS")).toEqual([blocking]);
  });

  it("names both when two rules each hold the seat on their own", () => {
    const never = rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["v1", "d1"] });
    const capped = rule({ kind: "LIMIT", userId: "d1", max: 0, period: "WEEK" });
    const held = ruleHeldRoles(
      stagedSet(SUN, [{ userId: "v1", role: "BASS" }]),
      [player("d1", ["DRUMS"]), player("v1", ["BASS"])],
      [],
      CAT,
      { schedulingRules: [never, capped] }
    );
    // Neither alone frees the seat — dropping one leaves the other holding it
    // — so the fallback names them all rather than none.
    expect(held.get("DRUMS")).toEqual([never, capped]);
  });
});
