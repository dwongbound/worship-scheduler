// The auto-fill obeying the org's scheduling rules (lib/scheduler.ts, rules
// from lib/schedulingRules.ts).
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  type SchedulerSet,
  type SchedulerUser,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import type { RuleParams, RuleTier, SchedulingRule } from "@/lib/schedulingRules";

const TEAM = "team-1";
const TZ = "America/Los_Angeles";

function user(id: string, roles: string[]): SchedulerUser {
  return { id, rolesByTeam: { [TEAM]: roles } };
}

// One role per set, so each test reads as "who got THAT seat".
function set(
  id: string,
  startsAt: Date,
  shape: Record<string, number>,
  extra: Partial<SchedulerSet> = {}
): SchedulerSet {
  return {
    id,
    startsAt,
    durationMinutes: 60,
    teamId: TEAM,
    roles: Object.entries(shape).map(([key, defaultCount], order) => ({
      key,
      label: key,
      defaultCount,
      adminOnly: false,
      order,
    })),
    ...extra,
  };
}

let n = 0;
function rule(params: RuleParams, tier: RuleTier = "REQUIRED", enabled = true): SchedulingRule {
  return { id: `r${++n}`, tier, enabled, params };
}

// Tue 6 Jan 2026 7pm, and every Tuesday after.
const tue = (week: number) => new Date(2026, 0, 6 + 7 * week, 19, 0);
// Sat 10 Jan / Sun 11 Jan 2026 — one Mon–Sun week.
const sat = new Date(2026, 0, 10, 19, 0);
const sun = new Date(2026, 0, 11, 9, 0);

const run = (
  sets: SchedulerSet[],
  users: SchedulerUser[],
  schedulingRules: SchedulingRule[],
  extra: { unavailable?: UnavailabilityRule[] } = {}
) =>
  buildSchedule(
    sets,
    users,
    extra.unavailable ?? [],
    new Map(),
    [],
    new Map(),
    { schedulingRules, timeZone: TZ }
  );

const seated = (result: { setId: string; userId: string; role: string }[], setId: string, role?: string) =>
  result
    .filter((a) => a.setId === setId && (!role || a.role === role))
    .map((a) => a.userId)
    .sort();

// A busy block covering one specific day, all day.
const busyOn = (userId: string, day: Date): UnavailabilityRule => ({
  userId,
  type: "DATE_RANGE",
  startDate: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
  endDate: new Date(day.getFullYear(), day.getMonth(), day.getDate()),
});

describe("no rules", () => {
  it("fills exactly as before (plain rotation)", () => {
    const users = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = run([set("s", tue(0), { DRUMS: 1 })], users, []);
    expect(seated(result, "s")).toEqual(["d1"]);
  });
});

describe("ONLY_IF_NEEDED (preference)", () => {
  const users = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];

  it("seats anyone else first", () => {
    const result = run([set("s", tue(0), { DRUMS: 1 })], users, [
      rule({ kind: "ONLY_IF_NEEDED", userId: "d1", role: null }, "PREFERENCE"),
    ]);
    expect(seated(result, "s")).toEqual(["d2"]);
  });

  it("still seats them rather than leave the slot empty", () => {
    const result = run(
      [set("s", tue(0), { DRUMS: 1 })],
      users,
      [rule({ kind: "ONLY_IF_NEEDED", userId: "d1", role: "DRUMS" }, "PREFERENCE")],
      { unavailable: [busyOn("d2", tue(0))] }
    );
    expect(seated(result, "s")).toEqual(["d1"]);
  });

  it("beats rotation: the last resort sits out even when the other just served", () => {
    const result = run(
      [set("w1", tue(0), { DRUMS: 1 }), set("w2", tue(1), { DRUMS: 1 })],
      users,
      [rule({ kind: "ONLY_IF_NEEDED", userId: "d1", role: null }, "PREFERENCE")]
    );
    expect(seated(result, "w1")).toEqual(["d2"]);
    expect(seated(result, "w2")).toEqual(["d2"]);
  });
});

describe("PREFER", () => {
  const users = [user("a", ["KEYS"]), user("b", ["KEYS"])];
  const prefer = { kind: "PREFER", userId: "b", otherUserId: "a", role: "KEYS" } as const;

  it("required: B over A every week, whatever rotation says", () => {
    const result = run(
      [set("w1", tue(0), { KEYS: 1 }), set("w2", tue(1), { KEYS: 1 })],
      users,
      [rule(prefer)]
    );
    expect(seated(result, "w1")).toEqual(["b"]);
    expect(seated(result, "w2")).toEqual(["b"]);
  });

  it("only applies to its own role", () => {
    const result = run([set("s", tue(0), { KEYS: 1 })], users, [rule({ ...prefer, role: "BASS" })]);
    expect(seated(result, "s")).toEqual(["a"]);
  });

  it("preferences are ranked: the higher one wins a disagreement", () => {
    const lastResortB = { kind: "ONLY_IF_NEEDED", userId: "b", role: null } as const;
    const s = [set("s", tue(0), { KEYS: 1 })];
    expect(
      seated(run(s, users, [rule(lastResortB, "PREFERENCE"), rule(prefer, "PREFERENCE")]), "s")
    ).toEqual(["a"]);
    expect(
      seated(run(s, users, [rule(prefer, "PREFERENCE"), rule(lastResortB, "PREFERENCE")]), "s")
    ).toEqual(["b"]);
  });
});

describe("TOGETHER", () => {
  it("required NEVER: the second vocal slot stays empty rather than pair them", () => {
    const users = [user("v1", ["VOCALS"]), user("v2", ["VOCALS"])];
    const result = run([set("s", tue(0), { VOCALS: 2 })], users, [
      rule({ kind: "TOGETHER", userIds: ["v1", "v2"], mode: "NEVER" }),
    ]);
    expect(seated(result, "s")).toEqual(["v1"]);
  });

  it("preference NEVER: bends to avoid an empty slot", () => {
    const users = [user("v1", ["VOCALS"]), user("v2", ["VOCALS"])];
    const result = run([set("s", tue(0), { VOCALS: 2 })], users, [
      rule({ kind: "TOGETHER", userIds: ["v1", "v2"], mode: "NEVER" }, "PREFERENCE"),
    ]);
    expect(seated(result, "s")).toEqual(["v1", "v2"]);
  });

  const band = [user("k1", ["KEYS"]), user("k2", ["KEYS"]), user("v1", ["VOCALS"]), user("v2", ["VOCALS"])];
  const always: RuleParams = { kind: "TOGETHER", userIds: ["k2", "v2"], mode: "ALWAYS" };

  it("ALWAYS: seating one seats the other", () => {
    // Rotation alone gives k1 + v1; the rule (with a lean toward k2) brings v2.
    const result = run([set("s", tue(0), { KEYS: 1, VOCALS: 1 })], band, [
      rule({ kind: "PREFER", userId: "k2", otherUserId: "k1", role: "KEYS" }),
      rule(always),
    ]);
    expect(seated(result, "s", "KEYS")).toEqual(["k2"]);
    expect(seated(result, "s", "VOCALS")).toEqual(["v2"]);
  });

  it("required ALWAYS: neither is seated when the other can't be", () => {
    const result = run(
      [set("s", tue(0), { KEYS: 1, VOCALS: 1 })],
      band,
      [rule({ kind: "PREFER", userId: "k2", otherUserId: "k1", role: "KEYS" }, "PREFERENCE"), rule(always)],
      { unavailable: [busyOn("v2", tue(0))] }
    );
    expect(seated(result, "s", "KEYS")).toEqual(["k1"]);
    expect(seated(result, "s", "VOCALS")).toEqual(["v1"]);
  });
});

describe("LIMIT", () => {
  const users = [user("b1", ["BASS"])];
  const sets = [0, 1, 2].map((w) => set(`w${w}`, tue(w), { BASS: 1 }));

  it("required: never past the cap, even if the slot stays empty", () => {
    const result = run(sets, users, [rule({ kind: "LIMIT", userId: "b1", max: 1, period: "MONTH" })]);
    expect(result.map((a) => a.setId)).toEqual(["w0"]);
  });

  it("preference: goes over rather than leave a slot empty", () => {
    const result = run(sets, users, [
      rule({ kind: "LIMIT", userId: "b1", max: 1, period: "MONTH" }, "PREFERENCE"),
    ]);
    expect(result.map((a) => a.setId)).toEqual(["w0", "w1", "w2"]);
  });

  it("weeks run Monday to Sunday", () => {
    // Sat + Sun are one week; the next Tuesday starts another.
    const s = [
      set("sat", sat, { BASS: 1 }),
      set("sun", sun, { BASS: 1 }),
      set("tue", new Date(2026, 0, 13, 19, 0), { BASS: 1 }),
    ];
    const result = run(s, users, [rule({ kind: "LIMIT", userId: "b1", max: 1, period: "WEEK" })]);
    expect(result.map((a) => a.setId)).toEqual(["sat", "tue"]);
  });

  it("counts bookings fed in for the limits only", () => {
    const result = buildSchedule(
      [set("s", tue(1), { BASS: 1 })],
      users,
      [],
      new Map(),
      [],
      new Map(),
      {
        schedulingRules: [rule({ kind: "LIMIT", userId: "b1", max: 1, period: "MONTH" })],
        periodBookings: [{ userId: "b1", startsAt: new Date(2026, 0, 27, 19, 0) }],
        timeZone: TZ,
      }
    );
    expect(result).toEqual([]);
  });
});

describe("SAME_PLAYER", () => {
  const guitars = [user("g1", ["ELECTRIC_GUITAR"]), user("g2", ["ELECTRIC_GUITAR"])];
  const weekend = () => [
    set("sat", sat, { ELECTRIC_GUITAR: 1 }, { templateId: "t-sat" }),
    set("sun", sun, { ELECTRIC_GUITAR: 1 }, { templateId: "t-sun" }),
  ];
  const weekly: RuleParams = {
    kind: "SAME_PLAYER",
    role: "ELECTRIC_GUITAR",
    scope: "WEEKLY",
    templateIds: ["t-sat", "t-sun"],
  };

  it("without a rule, the weekend rotates", () => {
    const result = run(weekend(), guitars, []);
    expect(seated(result, "sat")).toEqual(["g1"]);
    expect(seated(result, "sun")).toEqual(["g2"]);
  });

  it("weekly: Saturday's guitarist plays Sunday too", () => {
    const result = run(weekend(), guitars, [rule(weekly)]);
    expect(seated(result, "sun")).toEqual(["g1"]);
  });

  it("only pairs sets in the same Mon–Sun week", () => {
    const sets = [
      set("sun0", new Date(2026, 0, 4, 9, 0), { ELECTRIC_GUITAR: 1 }, { templateId: "t-sun" }),
      set("sat", sat, { ELECTRIC_GUITAR: 1 }, { templateId: "t-sat" }),
    ];
    // Sun 4 Jan is the week before Sat 10 Jan, so Saturday rotates freely.
    const result = run(sets, guitars, [rule(weekly)]);
    expect(seated(result, "sat")).toEqual(["g2"]);
  });

  it("required: the slot stays open when that player can't make it", () => {
    const result = run(weekend(), guitars, [rule(weekly)], {
      unavailable: [busyOn("g1", sun)],
    });
    expect(seated(result, "sun")).toEqual([]);
  });

  it("preference: someone else plays when that player can't make it", () => {
    const result = run(weekend(), guitars, [rule(weekly, "PREFERENCE")], {
      unavailable: [busyOn("g1", sun)],
    });
    expect(seated(result, "sun")).toEqual(["g2"]);
  });

  it("a role with spare slots still fills the rest", () => {
    const sets = [
      set("sat", sat, { ELECTRIC_GUITAR: 1 }, { templateId: "t-sat" }),
      set("sun", sun, { ELECTRIC_GUITAR: 2 }, { templateId: "t-sun" }),
    ];
    const result = run(sets, [...guitars, user("g3", ["ELECTRIC_GUITAR"])], [rule(weekly)], {
      unavailable: [busyOn("g1", sun)],
    });
    // One seat is held for g1 (who can't come); the other fills normally.
    expect(seated(result, "sun")).toEqual(["g2"]);
  });

  it("specific sets: pairs with a set outside this run", () => {
    const result = buildSchedule(
      [set("run", sun, { ELECTRIC_GUITAR: 1 }, { setId: "db-sun" })],
      guitars,
      [],
      new Map(),
      [],
      new Map(),
      {
        schedulingRules: [
          rule({ kind: "SAME_PLAYER", role: "ELECTRIC_GUITAR", scope: "ONCE", setIds: ["db-sat", "db-sun"] }),
        ],
        fixedSets: [
          { setId: "db-sat", startsAt: sat, assignments: [{ userId: "g2", role: "ELECTRIC_GUITAR" }] },
        ],
        timeZone: TZ,
      }
    );
    expect(seated(result, "run")).toEqual(["g2"]);
  });
});

describe("switched-off rules", () => {
  it("are ignored", () => {
    const users = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
    const result = run([set("s", tue(0), { DRUMS: 1 })], users, [
      rule({ kind: "ONLY_IF_NEEDED", userId: "d1", role: null }, "PREFERENCE", false),
    ]);
    expect(seated(result, "s")).toEqual(["d1"]);
  });
});
