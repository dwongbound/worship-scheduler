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

describe("team scope", () => {
  const OTHER = "team-2";
  const users = [user("d1", ["DRUMS"]), user("d2", ["DRUMS"])];
  const scoped = (teamId: string | null, params: RuleParams, tier: RuleTier = "PREFERENCE") => ({
    ...rule(params, tier),
    teamId,
  });

  it("a rule for another team changes nothing here", () => {
    const result = run([set("s", tue(0), { DRUMS: 1 })], users, [
      scoped(OTHER, { kind: "ONLY_IF_NEEDED", userId: "d1", role: null }),
    ]);
    expect(seated(result, "s")).toEqual(["d1"]);
  });

  it("a rule for this team applies", () => {
    const result = run([set("s", tue(0), { DRUMS: 1 })], users, [
      scoped(TEAM, { kind: "ONLY_IF_NEEDED", userId: "d1", role: null }),
    ]);
    expect(seated(result, "s")).toEqual(["d2"]);
  });

  it("a team-less set follows only the every-team rules", () => {
    const result = run([set("s", tue(0), { DRUMS: 1 }, { teamId: null })], users, [
      scoped(TEAM, { kind: "ONLY_IF_NEEDED", userId: "d1", role: null }),
    ]);
    expect(seated(result, "s")).toEqual(["d1"]);
  });

  it("a team's limit counts only that team's sets", () => {
    const b1: SchedulerUser = { id: "b1", rolesByTeam: { [TEAM]: ["BASS"], [OTHER]: ["BASS"] } };
    const sets = [
      set("other", tue(0), { BASS: 1 }, { teamId: OTHER }),
      set("mine-1", tue(1), { BASS: 1 }),
      set("mine-2", tue(2), { BASS: 1 }),
    ];
    const limit = { kind: "LIMIT", userId: "b1", max: 1, period: "MONTH" } as const;
    // Team-scoped: the other team's set doesn't use up this team's one.
    expect(run(sets, [b1], [scoped(TEAM, limit, "REQUIRED")]).map((a) => a.setId)).toEqual([
      "other",
      "mine-1",
    ]);
    // Every team: one set a month, wherever.
    expect(run(sets, [b1], [scoped(null, limit, "REQUIRED")]).map((a) => a.setId)).toEqual([
      "other",
    ]);
  });

  it("a team's limit counts that team's bookings fed in, and not the others'", () => {
    const b1: SchedulerUser = { id: "b1", rolesByTeam: { [TEAM]: ["BASS"] } };
    const limit = { ...rule({ kind: "LIMIT", userId: "b1", max: 1, period: "MONTH" }), teamId: TEAM };
    const fill = (teamId: string) =>
      buildSchedule([set("s", tue(1), { BASS: 1 })], [b1], [], new Map(), [], new Map(), {
        schedulingRules: [limit],
        periodBookings: [{ userId: "b1", startsAt: tue(2), teamId }],
        timeZone: TZ,
      });
    expect(fill(TEAM)).toEqual([]);
    expect(fill(OTHER).map((a) => a.userId)).toEqual(["b1"]);
  });
});

describe("MD_ORDER", () => {
  // keys and electric are both MDs; rotation alone would seat neither first.
  const users: SchedulerUser[] = [
    { id: "eg", isMD: true, rolesByTeam: { [TEAM]: ["ELECTRIC_GUITAR"] } },
    { id: "k", isMD: true, rolesByTeam: { [TEAM]: ["KEYS"] } },
    { id: "dr", isMD: true, rolesByTeam: { [TEAM]: ["DRUMS"] } },
  ];
  // Only one slot at all, so the MD seat is the whole roster.
  const mdSet = (shape: Record<string, number>) =>
    set("s", tue(0), { MD: 1, ...shape }, { requiresMD: true });
  const order = (roles: string[], teamId: string | null = null) => ({
    ...rule({ kind: "MD_ORDER", roles }),
    teamId,
  });

  it("an MD can lead from a role only the order names", () => {
    // Drums alone: with the built-in order nobody can lead, so the fill seats
    // whoever rotation picks; naming drums lets the drummer lead.
    const result = run([mdSet({ DRUMS: 1 })], users, [order(["DRUMS"])]);
    expect(seated(result, "s")).toEqual(["dr"]);
  });

  it("the reserved MD takes the first open role in the order", () => {
    // Rotation seats the two plain players first ("a-…" sorts ahead), leaving
    // nobody who can lead — so the set is refilled with a seat held for the MD,
    // in the most preferred role they play.
    const pool: SchedulerUser[] = [
      { id: "a-eg", rolesByTeam: { [TEAM]: ["ELECTRIC_GUITAR"] } },
      { id: "a-k", rolesByTeam: { [TEAM]: ["KEYS"] } },
      { id: "z-md", isMD: true, rolesByTeam: { [TEAM]: ["ELECTRIC_GUITAR", "KEYS"] } },
    ];
    const both = mdSet({ ELECTRIC_GUITAR: 1, KEYS: 1 });
    expect(seated(run([both], pool, []), "s", "ELECTRIC_GUITAR")).toEqual(["z-md"]);
    expect(seated(run([both], pool, [order(["KEYS", "ELECTRIC_GUITAR"])]), "s", "KEYS")).toEqual([
      "z-md",
    ]);
  });

  it("a team's own order replaces the every-team one", () => {
    const result = run([mdSet({ DRUMS: 1 })], users, [
      order(["KEYS"]),
      order(["DRUMS"], TEAM),
    ]);
    expect(seated(result, "s")).toEqual(["dr"]);
  });

  it("a switched-off order falls back to the built-in one", () => {
    const off = { ...order(["DRUMS"]), enabled: false };
    const result = run(
      [mdSet({ DRUMS: 1, KEYS: 1 })],
      [
        { id: "a-drums", rolesByTeam: { [TEAM]: ["DRUMS"] } },
        { id: "b-keys", rolesByTeam: { [TEAM]: ["KEYS"] } },
        { id: "z-md", isMD: true, rolesByTeam: { [TEAM]: ["KEYS"] } },
      ],
      [off]
    );
    // Built-in order: keys can lead, so the MD is reserved the keys seat.
    expect(seated(result, "s", "KEYS")).toEqual(["z-md"]);
  });
});

describe("SHARE_ROLES", () => {
  const shape = { WORSHIP_LEADER: 1, ACOUSTIC_GUITAR: 1 };
  const wlAcoustic = user("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]);
  const acousticOnly = user("ag", ["ACOUSTIC_GUITAR"]);
  const share = (tier: RuleTier, withRoles = ["WORSHIP_LEADER"], role = "ACOUSTIC_GUITAR") =>
    rule({ kind: "SHARE_ROLES", role, withRoles }, tier);

  it("with no rules nobody plays two roles, and the role is an ordinary seat", () => {
    const result = run([set("s", tue(0), shape)], [wlAcoustic, acousticOnly], []);
    expect(seated(result, "s", "WORSHIP_LEADER")).toEqual(["wl"]);
    expect(seated(result, "s", "ACOUSTIC_GUITAR")).toEqual(["ag"]);
  });

  it("required: only the seated worship leader may take it", () => {
    const result = run([set("s", tue(0), shape)], [wlAcoustic, acousticOnly], [share("REQUIRED")]);
    expect(seated(result, "s", "ACOUSTIC_GUITAR")).toEqual(["wl"]);
  });

  it("required: left open rather than given to a dedicated player", () => {
    const wlOnly = user("wl2", ["WORSHIP_LEADER"]);
    const result = run([set("s", tue(0), shape)], [wlOnly, acousticOnly], [share("REQUIRED")]);
    expect(seated(result, "s", "ACOUSTIC_GUITAR")).toEqual([]);
  });

  it("preference: the worship leader first, anyone as a fallback", () => {
    expect(
      seated(run([set("s", tue(0), shape)], [wlAcoustic, acousticOnly], [share("PREFERENCE")]), "s", "ACOUSTIC_GUITAR")
    ).toEqual(["wl"]);
    const wlOnly = user("wl2", ["WORSHIP_LEADER"]);
    expect(
      seated(run([set("s", tue(0), shape)], [wlOnly, acousticOnly], [share("PREFERENCE")]), "s", "ACOUSTIC_GUITAR")
    ).toEqual(["ag"]);
  });

  it("works for any pair of roles, not just acoustic", () => {
    const singer = user("v", ["VOCALS", "KEYS"]);
    const keys = user("k", ["KEYS"]);
    const result = run(
      [set("s", tue(0), { VOCALS: 1, KEYS: 1 })],
      [singer, keys],
      [share("REQUIRED", ["VOCALS"], "KEYS")]
    );
    expect(seated(result, "s", "KEYS")).toEqual(["v"]);
  });

  it("two allowed pairs don't add up to a third", () => {
    // WL+acoustic and acoustic+vox are allowed; WL+vox is not.
    const all = user("p", ["WORSHIP_LEADER", "VOCALS", "ACOUSTIC_GUITAR"]);
    const result = run(
      [set("s", tue(0), { WORSHIP_LEADER: 1, VOCALS: 1, ACOUSTIC_GUITAR: 1 })],
      [all],
      [share("REQUIRED", ["WORSHIP_LEADER", "VOCALS"])]
    );
    expect(result.map((a) => a.role).sort()).toEqual(["ACOUSTIC_GUITAR", "WORSHIP_LEADER"]);
  });

  it("a team's rule doesn't let another team's set double up", () => {
    const result = run(
      [set("s", tue(0), shape)],
      [wlAcoustic, acousticOnly],
      [{ ...share("REQUIRED"), teamId: "team-2" }]
    );
    expect(seated(result, "s", "ACOUSTIC_GUITAR")).toEqual(["ag"]);
  });
});

describe("no list given", () => {
  it("follows the defaults every org starts with (the acoustic doubles as the leader)", () => {
    const users = [
      user("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]),
      user("ag", ["ACOUSTIC_GUITAR"]),
    ];
    const result = buildSchedule(
      [set("s", tue(0), { WORSHIP_LEADER: 1, ACOUSTIC_GUITAR: 1 })],
      users,
      []
    );
    expect(seated(result, "s", "ACOUSTIC_GUITAR")).toEqual(["wl"]);
  });
});

describe("required ALWAYS chains", () => {
  it("seats the whole chain or none of it", () => {
    // a–b and b–c must always serve together, so a also needs c. c can't make
    // it, so none of the three is seated and the slots go to the others.
    const users = [
      user("a", ["DRUMS"]),
      user("b", ["BASS"]),
      user("c", ["KEYS"]),
      user("x-drums", ["DRUMS"]),
      user("x-bass", ["BASS"]),
    ];
    const result = run(
      [set("s", tue(0), { DRUMS: 1, BASS: 1, KEYS: 1 })],
      users,
      [
        rule({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }),
        rule({ kind: "TOGETHER", userIds: ["b", "c"], mode: "ALWAYS" }),
      ],
      { unavailable: [busyOn("c", tue(0))] }
    );
    expect(seated(result, "s")).toEqual(["x-bass", "x-drums"]);
  });

  it("and seats all three when they can come", () => {
    const users = [user("a", ["DRUMS"]), user("b", ["BASS"]), user("c", ["KEYS"])];
    const result = run([set("s", tue(0), { DRUMS: 1, BASS: 1, KEYS: 1 })], users, [
      rule({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }),
      rule({ kind: "TOGETHER", userIds: ["b", "c"], mode: "ALWAYS" }),
    ]);
    expect(seated(result, "s")).toEqual(["a", "b", "c"]);
  });
});
