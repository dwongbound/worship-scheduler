// The rules' vocabulary: parsing, validation against an org, contradictions
// between required rules, and the week/month buckets (lib/schedulingRules.ts).
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  defaultRuleRows,
  describeRule,
  explainRule,
  findContradiction,
  mdRolesFor,
  monthKey,
  parseRuleParams,
  parseStoredRules,
  ruleSentence,
  templateIdOf,
  validateRules,
  weekKey,
  type RuleParams,
  type RuleRefs,
  type SchedulingRule,
} from "@/lib/schedulingRules";

const TZ = "America/Los_Angeles";

const refs: RuleRefs = {
  userIds: new Set(["a", "b", "c"]),
  roleKeys: new Set(["KEYS", "BASS"]),
  templateIds: new Set(["t1", "t2"]),
  setIds: new Set(["s1", "s2"]),
};

let n = 0;
const req = (params: RuleParams, enabled = true): SchedulingRule => ({
  id: `r${++n}`,
  tier: "REQUIRED",
  enabled,
  params,
});
const pref = (params: RuleParams): SchedulingRule => ({ ...req(params), tier: "PREFERENCE" });

describe("parseRuleParams", () => {
  it("accepts each kind and drops unknown keys", () => {
    expect(parseRuleParams({ kind: "LIMIT", userId: "a", max: "2", period: "MONTH", extra: 1 })).toEqual({
      kind: "LIMIT",
      userId: "a",
      max: 2,
      period: "MONTH",
    });
    expect(parseRuleParams({ kind: "ONLY_IF_NEEDED", userId: "a" })).toEqual({
      kind: "ONLY_IF_NEEDED",
      userId: "a",
      role: null,
    });
  });

  it("refuses the same person twice, the same set twice, and bad limits", () => {
    expect(parseRuleParams({ kind: "PREFER", userId: "a", otherUserId: "a", role: "KEYS" })).toBe(
      "Pick two different people."
    );
    expect(
      parseRuleParams({ kind: "SAME_PLAYER", role: "KEYS", scope: "ONCE", setIds: ["s1", "s1"] })
    ).toBe("Pick two different sets.");
    expect(typeof parseRuleParams({ kind: "LIMIT", userId: "a", max: 0, period: "WEEK" })).toBe("string");
    expect(typeof parseRuleParams({ kind: "NOPE" })).toBe("string");
  });
});

describe("parseStoredRules", () => {
  it("skips rows that no longer parse, and keeps ONLY_IF_NEEDED a preference", () => {
    const rules = parseStoredRules([
      { id: "1", tier: "REQUIRED", enabled: true, params: { kind: "ONLY_IF_NEEDED", userId: "a" } },
      { id: "2", tier: "REQUIRED", enabled: true, params: { kind: "BROKEN" } },
    ]);
    expect(rules).toHaveLength(1);
    expect(rules[0].tier).toBe("PREFERENCE");
  });
});

describe("validateRules", () => {
  it("returns the cleaned list in order", () => {
    const result = validateRules(
      [
        { tier: "PREFERENCE", params: { kind: "ONLY_IF_NEEDED", userId: "a", role: "KEYS" } },
        { tier: "REQUIRED", enabled: false, params: { kind: "LIMIT", userId: "b", max: 2, period: "WEEK" } },
      ],
      refs
    );
    expect(result).toEqual({
      ok: true,
      rules: [
        { tier: "PREFERENCE", enabled: true, teamId: null, params: { kind: "ONLY_IF_NEEDED", userId: "a", role: "KEYS" } },
        { tier: "REQUIRED", enabled: false, teamId: null, params: { kind: "LIMIT", userId: "b", max: 2, period: "WEEK" } },
      ],
    });
  });

  it("refuses references outside the org, naming the rule", () => {
    expect(
      validateRules(
        [
          { tier: "PREFERENCE", params: { kind: "ONLY_IF_NEEDED", userId: "a", role: null } },
          { tier: "REQUIRED", params: { kind: "LIMIT", userId: "stranger", max: 1, period: "WEEK" } },
        ],
        refs
      )
    ).toMatchObject({ ok: false, index: 1 });
    expect(
      validateRules([{ params: { kind: "PREFER", userId: "a", otherUserId: "b", role: "DRUMS" } }], refs)
    ).toMatchObject({ ok: false, index: 0 });
  });

  it("refuses contradicting required rules", () => {
    expect(
      validateRules(
        [
          { tier: "REQUIRED", params: { kind: "TOGETHER", userIds: ["a", "b"], mode: "NEVER" } },
          { tier: "REQUIRED", params: { kind: "TOGETHER", userIds: ["b", "a"], mode: "ALWAYS" } },
        ],
        refs
      )
    ).toMatchObject({ ok: false, index: 1 });
  });
});

describe("findContradiction", () => {
  it("always vs never on the same pair", () => {
    const clash = findContradiction([
      req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }),
      req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "NEVER" }),
    ]);
    expect(clash).toMatchObject({ index: 1, otherIndex: 0 });
    expect(clash?.message).toMatch(/together and never/);
  });

  it("follows chains of ALWAYS", () => {
    const clash = findContradiction([
      req({ kind: "TOGETHER", userIds: ["a", "c"], mode: "NEVER" }),
      req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }),
      req({ kind: "TOGETHER", userIds: ["b", "c"], mode: "ALWAYS" }),
    ]);
    expect(clash?.index).toBe(2);
  });

  it("a cycle of PREFER in one role", () => {
    expect(
      findContradiction([
        req({ kind: "PREFER", userId: "a", otherUserId: "b", role: "KEYS" }),
        req({ kind: "PREFER", userId: "b", otherUserId: "c", role: "KEYS" }),
        req({ kind: "PREFER", userId: "c", otherUserId: "a", role: "KEYS" }),
      ])?.index
    ).toBe(2);
    // Different roles don't form a cycle.
    expect(
      findContradiction([
        req({ kind: "PREFER", userId: "a", otherUserId: "b", role: "KEYS" }),
        req({ kind: "PREFER", userId: "b", otherUserId: "a", role: "BASS" }),
      ])
    ).toBeNull();
  });

  it("two different required limits for one person and period", () => {
    expect(
      findContradiction([
        req({ kind: "LIMIT", userId: "a", max: 2, period: "MONTH" }),
        req({ kind: "LIMIT", userId: "a", max: 3, period: "MONTH" }),
      ])
    ).toMatchObject({ index: 1, otherIndex: 0, message: expect.stringMatching(/different required limit/) });
    expect(
      findContradiction([
        req({ kind: "LIMIT", userId: "a", max: 1, period: "WEEK" }),
        req({ kind: "LIMIT", userId: "a", max: 3, period: "MONTH" }),
      ])
    ).toBeNull();
  });

  it("the same required rule twice, in either pair order", () => {
    expect(
      findContradiction([
        req({ kind: "SAME_PLAYER", role: "KEYS", scope: "WEEKLY", templateIds: ["t1", "t2"] }),
        req({ kind: "SAME_PLAYER", role: "KEYS", scope: "WEEKLY", templateIds: ["t2", "t1"] }),
      ])?.message
    ).toMatch(/already on the list/);
  });

  it("ignores preferences and switched-off rules", () => {
    expect(
      findContradiction([
        req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }),
        pref({ kind: "TOGETHER", userIds: ["a", "b"], mode: "NEVER" }),
        req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "NEVER" }, false),
      ])
    ).toBeNull();
  });
});

describe("weekKey / monthKey", () => {
  it("weeks run Monday to Sunday on the app's clock", () => {
    // Sat 10 Jan and Sun 11 Jan 2026 share a week starting Mon 5 Jan.
    expect(weekKey(new Date("2026-01-11T05:00:00Z"), TZ)).toBe(20260105); // Sat 9pm LA
    expect(weekKey(new Date("2026-01-11T17:00:00Z"), TZ)).toBe(20260105); // Sun 9am LA
    expect(weekKey(new Date("2026-01-12T17:00:00Z"), TZ)).toBe(20260112); // Mon
    // Across a month boundary: Sun 1 Feb 2026 belongs to the week of Mon 26 Jan.
    expect(weekKey(new Date("2026-02-01T17:00:00Z"), TZ)).toBe(20260126);
  });

  it("months follow the app's clock, not UTC", () => {
    // 31 Jan 9pm in LA is already 1 Feb in UTC.
    expect(monthKey(new Date("2026-02-01T05:00:00Z"), TZ)).toBe(202601);
  });
});

describe("templateIdOf", () => {
  const templates = [
    { id: "t-sun", label: "Sunday 9AM", teamId: "team", dayOfWeek: 0, startMinute: 540 },
  ];
  it("matches name, team, weekday and time", () => {
    const at = new Date("2026-01-11T17:00:00Z"); // Sun 9am LA
    expect(templateIdOf({ label: "Sunday 9AM", teamId: "team", startsAt: at }, templates, TZ)).toBe("t-sun");
    expect(templateIdOf({ label: "Other", teamId: "team", startsAt: at }, templates, TZ)).toBeNull();
  });
});

describe("describeRule", () => {
  it("reads as a sentence with the names picked out", () => {
    const names = {
      user: (id: string) => ({ a: "Priya", b: "Hannah" })[id] ?? id,
      role: (k: string) => (k === "KEYS" ? "Keys" : k),
      template: (id: string) => id,
      set: (id: string) => id,
    };
    const p: RuleParams = { kind: "PREFER", userId: "a", otherUserId: "b", role: "KEYS" };
    expect(ruleSentence(p, names)).toBe("Pick Priya over Hannah on Keys");
    expect(describeRule(p, names).filter((x) => x.strong).map((x) => x.text)).toEqual([
      "Priya",
      "Hannah",
      "Keys",
    ]);
  });
});

describe("MD_ORDER and SHARE_ROLES", () => {
  it("parse, refusing empty, duplicate and self-shared lists", () => {
    expect(parseRuleParams({ kind: "MD_ORDER", roles: ["KEYS", "BASS"] })).toEqual({
      kind: "MD_ORDER",
      roles: ["KEYS", "BASS"],
    });
    expect(typeof parseRuleParams({ kind: "MD_ORDER", roles: [] })).toBe("string");
    expect(parseRuleParams({ kind: "MD_ORDER", roles: ["KEYS", "KEYS"] })).toBe("Pick each role once.");
    expect(parseRuleParams({ kind: "MD_ORDER", roles: ["WORSHIP_LEADER"] })).toBe(
      "The worship leader can't also be the MD."
    );
    expect(typeof parseRuleParams({ kind: "SHARE_ROLES", role: "MD", withRoles: ["KEYS"] })).toBe("string");
    expect(
      parseRuleParams({ kind: "SHARE_ROLES", role: "ACOUSTIC_GUITAR", withRoles: ["WORSHIP_LEADER"] })
    ).toEqual({ kind: "SHARE_ROLES", role: "ACOUSTIC_GUITAR", withRoles: ["WORSHIP_LEADER"] });
    expect(parseRuleParams({ kind: "SHARE_ROLES", role: "KEYS", withRoles: ["KEYS"] })).toBe(
      "A role can't be shared with itself."
    );
  });

  it("an MD order is always required", () => {
    const [rule] = parseStoredRules([
      { id: "1", tier: "PREFERENCE", enabled: true, params: { kind: "MD_ORDER", roles: ["KEYS"] } },
    ]);
    expect(rule.tier).toBe("REQUIRED");
  });

  it("mdRolesFor: the team's own, else every team's, else the built-in", () => {
    const all = { ...req({ kind: "MD_ORDER", roles: ["KEYS"] }), teamId: null };
    const mine = { ...req({ kind: "MD_ORDER", roles: ["BASS"] }), teamId: "t-a" };
    expect(mdRolesFor([all, mine], "t-a")).toEqual(["BASS"]);
    expect(mdRolesFor([all, mine], "t-b")).toEqual(["KEYS"]);
    expect(mdRolesFor([all, mine], null)).toEqual(["KEYS"]);
    expect(mdRolesFor([], "t-a")).toEqual(["ELECTRIC_GUITAR", "KEYS", "BASS"]);
    expect(mdRolesFor([{ ...mine, enabled: false }], "t-a")).toEqual(["ELECTRIC_GUITAR", "KEYS", "BASS"]);
  });

  it("the defaults spell out what used to be built in", () => {
    expect(DEFAULT_RULES.map((r) => r.params)).toEqual([
      { kind: "MD_ORDER", roles: ["ELECTRIC_GUITAR", "KEYS", "BASS"] },
      { kind: "SHARE_ROLES", role: "ACOUSTIC_GUITAR", withRoles: ["WORSHIP_LEADER", "VOCALS"] },
    ]);
    expect(defaultRuleRows().map((r) => r.position)).toEqual([0, 1]);
    // Every default is valid on its own terms.
    for (const r of DEFAULT_RULES) expect(typeof parseRuleParams(r.params)).not.toBe("string");
  });

  it("read as sentences", () => {
    const names = {
      user: (id: string) => id,
      role: (k: string) => ({ ELECTRIC_GUITAR: "Electric", KEYS: "Keys", BASS: "Bass", WORSHIP_LEADER: "WL", VOCALS: "Vox", ACOUSTIC_GUITAR: "Acoustic" })[k] ?? k,
      template: (id: string) => id,
      set: (id: string) => id,
    };
    expect(ruleSentence(DEFAULT_RULES[0].params, names)).toBe(
      "Musical directors lead from Electric, Keys then Bass"
    );
    expect(ruleSentence(DEFAULT_RULES[1].params, names)).toBe(
      "Whoever plays WL or Vox may also play Acoustic"
    );
    expect(explainRule(DEFAULT_RULES[1].params, "REQUIRED", names)).toMatch(/stays open/);
    expect(explainRule(DEFAULT_RULES[1].params, "PREFERENCE", names)).toMatch(/anyone who plays/);
  });
});

describe("team scope", () => {
  const teamRefs: RuleRefs = {
    ...refs,
    teamRoleKeys: new Map([
      ["t-a", new Set(["KEYS"])],
      ["t-b", new Set(["KEYS", "BASS"])],
    ]),
  };
  const limit = (max: number, teamId: string | null): SchedulingRule => ({
    ...req({ kind: "LIMIT", userId: "a", max, period: "MONTH" }),
    teamId,
  });

  it("keeps the team, and refuses a team or role the org doesn't have", () => {
    const ok = validateRules(
      [{ tier: "REQUIRED", teamId: "t-b", params: { kind: "MD_ORDER", roles: ["BASS"] } }],
      teamRefs
    );
    expect(ok).toMatchObject({ ok: true, rules: [{ teamId: "t-b" }] });
    expect(
      validateRules([{ teamId: "t-a", params: { kind: "MD_ORDER", roles: ["BASS"] } }], teamRefs)
    ).toEqual({ ok: false, error: "That team doesn't have that role.", index: 0 });
    expect(
      validateRules([{ teamId: "gone", params: { kind: "MD_ORDER", roles: ["KEYS"] } }], teamRefs)
    ).toEqual({ ok: false, error: "That team doesn't exist any more.", index: 0 });
  });

  it("different teams' caps never clash, but one team's two caps do", () => {
    expect(findContradiction([limit(1, "t-a"), limit(2, "t-b")])).toBeNull();
    expect(findContradiction([limit(1, null), limit(2, "t-a")])).toBeNull();
    expect(findContradiction([limit(1, "t-a"), limit(2, "t-a")])).toMatchObject({ index: 1, otherIndex: 0 });
  });

  it("an every-team rule meets each team's rules", () => {
    const always = { ...req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "ALWAYS" }), teamId: null };
    const never = { ...req({ kind: "TOGETHER", userIds: ["a", "b"], mode: "NEVER" }), teamId: "t-a" };
    expect(findContradiction([always, never])).toMatchObject({ index: 1 });
    // Two teams' opposite rules never meet.
    expect(findContradiction([{ ...always, teamId: "t-b" }, never])).toBeNull();
  });

  it("one MD order per scope", () => {
    const md = (teamId: string | null): SchedulingRule => ({
      ...req({ kind: "MD_ORDER", roles: [teamId === "t-a" ? "KEYS" : "BASS"] }),
      teamId,
    });
    expect(findContradiction([md(null), md("t-a")])).toBeNull();
    expect(findContradiction([md(null), { ...md(null), params: { kind: "MD_ORDER", roles: ["KEYS"] } }])).toMatchObject({
      index: 1,
      message: "There's already an MD order for every team.",
    });
    expect(findContradiction([md("t-a"), { ...md("t-a"), params: { kind: "MD_ORDER", roles: ["BASS"] } }])).toMatchObject({
      message: "This team already has an MD order.",
    });
  });
});
