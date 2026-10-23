// resolveRoleBehavior / defaultRoleRules (lib/schedulingRules.ts): the built-in
// behaviours (MD leads-from, acoustic's host roles, which roles double up) as
// rules, and the fallback that keeps an org with no such rules unchanged.
import { describe, expect, it } from "vitest";
import {
  defaultRoleRules,
  resolveRoleBehavior,
  type RuleParams,
  type SchedulingRule,
} from "@/lib/schedulingRules";

const BUILT_IN = {
  mdRoles: ["ELECTRIC_GUITAR", "KEYS", "BASS"],
  hostRoles: { ACOUSTIC_GUITAR: ["WORSHIP_LEADER", "VOCALS"] },
  doublePairs: [
    ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"],
    ["ACOUSTIC_GUITAR", "VOCALS"],
  ] as [string, string][],
};

let n = 0;
const rule = (params: RuleParams, enabled = true): SchedulingRule => ({
  id: `r${++n}`,
  tier: "REQUIRED",
  enabled,
  params,
});

describe("resolveRoleBehavior with no rules", () => {
  const b = resolveRoleBehavior([], BUILT_IN);

  it("falls back to the built-in behaviour, so nothing changes", () => {
    expect(b.mdRoles).toEqual(["ELECTRIC_GUITAR", "KEYS", "BASS"]);
    expect(b.hostRolesFor("ACOUSTIC_GUITAR")).toEqual(["WORSHIP_LEADER", "VOCALS"]);
    expect(b.hostRolesFor("DRUMS")).toBeNull();
    expect(b.mayDouble("WORSHIP_LEADER", "ACOUSTIC_GUITAR")).toBe(true);
    expect(b.mayDouble("ACOUSTIC_GUITAR", "WORSHIP_LEADER")).toBe(true); // unordered
    expect(b.mayDouble("KEYS", "DRUMS")).toBe(false);
  });

  it("treats undefined rules the same as none", () => {
    expect(resolveRoleBehavior(undefined, BUILT_IN).mdRoles).toEqual(BUILT_IN.mdRoles);
  });
});

describe("resolveRoleBehavior with rules", () => {
  it("a LEADS_FROM rule replaces the built-in list", () => {
    const b = resolveRoleBehavior([rule({ kind: "LEADS_FROM", roles: ["KEYS"] })], BUILT_IN);
    expect(b.mdRoles).toEqual(["KEYS"]);
  });

  it("a switched-off LEADS_FROM means nothing counts as leading", () => {
    // Deliberately NOT a fallback to the built-in: an admin must be able to
    // turn the behaviour off, which is impossible if "off" means "default".
    const b = resolveRoleBehavior(
      [rule({ kind: "LEADS_FROM", roles: ["KEYS"] }, false)],
      BUILT_IN
    );
    expect(b.mdRoles).toEqual([]);
  });

  it("a ROLE_HOST rule governs its own role only", () => {
    const b = resolveRoleBehavior(
      [rule({ kind: "ROLE_HOST", role: "SHAKER", hostRoles: ["VOCALS"] })],
      BUILT_IN
    );
    expect(b.hostRolesFor("SHAKER")).toEqual(["VOCALS"]);
    // Acoustic keeps its built-in default — adding a rule for one role must
    // not quietly free another.
    expect(b.hostRolesFor("ACOUSTIC_GUITAR")).toEqual(["WORSHIP_LEADER", "VOCALS"]);
  });

  it("a switched-off ROLE_HOST frees that role", () => {
    const b = resolveRoleBehavior(
      [rule({ kind: "ROLE_HOST", role: "ACOUSTIC_GUITAR", hostRoles: ["VOCALS"] }, false)],
      BUILT_IN
    );
    expect(b.hostRolesFor("ACOUSTIC_GUITAR")).toBeNull();
  });

  it("MAY_DOUBLE is per pair, and off means that pair can't double", () => {
    const b = resolveRoleBehavior(
      [
        rule({ kind: "MAY_DOUBLE", roles: ["KEYS", "VOCALS"] }),
        rule({ kind: "MAY_DOUBLE", roles: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"] }, false),
      ],
      BUILT_IN
    );
    expect(b.mayDouble("KEYS", "VOCALS")).toBe(true);
    expect(b.mayDouble("WORSHIP_LEADER", "ACOUSTIC_GUITAR")).toBe(false);
    // Untouched pairs keep the built-in answer.
    expect(b.mayDouble("ACOUSTIC_GUITAR", "VOCALS")).toBe(true);
  });
});

describe("defaultRoleRules", () => {
  const defaults = defaultRoleRules(BUILT_IN);

  it("writes out exactly the built-in behaviour", () => {
    expect(defaults.map((r) => r.params.kind)).toEqual([
      "LEADS_FROM",
      "ROLE_HOST",
      "MAY_DOUBLE",
      "MAY_DOUBLE",
    ]);
    expect(defaults.every((r) => r.tier === "REQUIRED" && r.enabled)).toBe(true);
  });

  it("resolves back to the same behaviour it replaced", () => {
    const seeded = resolveRoleBehavior(
      defaults.map((r, i) => ({ ...r, id: `d${i}` })),
      BUILT_IN
    );
    const bare = resolveRoleBehavior([], BUILT_IN);
    expect(seeded.mdRoles).toEqual(bare.mdRoles);
    expect(seeded.hostRolesFor("ACOUSTIC_GUITAR")).toEqual(
      bare.hostRolesFor("ACOUSTIC_GUITAR")
    );
    expect(seeded.mayDouble("WORSHIP_LEADER", "ACOUSTIC_GUITAR")).toBe(true);
  });
});
