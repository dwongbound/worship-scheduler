// Unit tests for lib/teamRoles.ts — the per-team role vocabulary: how a
// catalog resolves into a set's shape, what a role is called, how a custom
// role's key is derived, and what the catalog editor will accept.
import { describe, expect, it } from "vitest";
import {
  CHOIR,
  INSTRUMENT_LABELS,
  MAX_SLOTS_PER_ROLE,
  ROLE_ORDER,
  SLOT_CAPACITIES,
} from "@/lib/constants";
import {
  CHOIR_KEY,
  DEFAULT_TEAM_ROLES,
  MAX_MDS_PER_SET,
  MD_KEY,
  teamSupportsMD,
  bandRoles,
  orderedRoles,
  resolveTeamCapacities,
  roleKeyFromLabel,
  roleLabel,
  validateCatalog,
  type TeamRoleDef,
} from "@/lib/teamRoles";

// A small hand-rolled catalog: one built-in role and one the team invented.
const catalog: TeamRoleDef[] = [
  { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 0 },
  {
    key: "SOUND_BOOTH",
    label: "Sound Booth",
    defaultCount: 2,
    adminOnly: true,
    order: 1,
  },
  { key: CHOIR_KEY, label: "Choir", defaultCount: 0, adminOnly: false, order: 2 },
];

describe("DEFAULT_TEAM_ROLES", () => {
  it("is the built-in role list every new team starts with", () => {
    expect(DEFAULT_TEAM_ROLES.map((r) => r.key)).toEqual([
      ...ROLE_ORDER,
      MD_KEY,
      CHOIR,
    ]);
  });

  it("carries the built-in counts and labels", () => {
    const drums = DEFAULT_TEAM_ROLES.find((r) => r.key === "DRUMS")!;
    expect(drums.defaultCount).toBe(SLOT_CAPACITIES.DRUMS);
    expect(drums.label).toBe(INSTRUMENT_LABELS.DRUMS);
  });

  it("marks nothing admin-only except MD", () => {
    // Nothing is admin-only until an admin says so — MD is the one exception,
    // since an admin has always been the one to say who may lead a set.
    const adminOnly = DEFAULT_TEAM_ROLES.filter((r) => r.adminOnly);
    expect(adminOnly.map((r) => r.key)).toEqual([MD_KEY]);
  });
});

describe("MD as a catalog role", () => {
  it("is present by default, capped at one per set", () => {
    const md = DEFAULT_TEAM_ROLES.find((r) => r.key === MD_KEY)!;
    expect(md.defaultCount).toBe(MAX_MDS_PER_SET);
    expect(MAX_MDS_PER_SET).toBe(1);
  });

  it("carries no slot of its own — the MD is already playing something", () => {
    expect(bandRoles(DEFAULT_TEAM_ROLES).map((r) => r.key)).not.toContain(MD_KEY);
    expect(resolveTeamCapacities(DEFAULT_TEAM_ROLES, null)).not.toHaveProperty(
      MD_KEY
    );
  });

  it("teamSupportsMD follows the catalog, so a team can drop MD entirely", () => {
    expect(teamSupportsMD(DEFAULT_TEAM_ROLES)).toBe(true);
    const noMD = DEFAULT_TEAM_ROLES.filter((r) => r.key !== MD_KEY);
    expect(teamSupportsMD(noMD)).toBe(false);
  });

  it("rejects an MD count above one", () => {
    const res = validateCatalog([
      { key: MD_KEY, label: "MD", defaultCount: 2, adminOnly: true },
    ]);
    expect("error" in res && res.error).toMatch(/between 0 and 1/);
  });

  it("accepts an MD count of 0 or 1", () => {
    for (const defaultCount of [0, 1]) {
      const res = validateCatalog([
        { key: MD_KEY, label: "MD", defaultCount, adminOnly: true },
      ]);
      expect("error" in res).toBe(false);
    }
  });

  it("still allows a normal role the full slot ceiling", () => {
    const res = validateCatalog([
      { key: "VOCALS", label: "Vox", defaultCount: 4, adminOnly: false },
    ]);
    expect("error" in res).toBe(false);
  });
});

describe("orderedRoles / bandRoles", () => {
  it("sorts by order, then key for a stable tie-break", () => {
    const scrambled: TeamRoleDef[] = [
      { key: "B", label: "B", defaultCount: 1, adminOnly: false, order: 1 },
      { key: "A", label: "A", defaultCount: 1, adminOnly: false, order: 1 },
      { key: "C", label: "C", defaultCount: 1, adminOnly: false, order: 0 },
    ];
    expect(orderedRoles(scrambled).map((r) => r.key)).toEqual(["C", "A", "B"]);
  });

  it("drops choir from the capacity-bearing roles", () => {
    expect(bandRoles(catalog).map((r) => r.key)).toEqual([
      "DRUMS",
      "SOUND_BOOTH",
    ]);
  });
});

describe("resolveTeamCapacities", () => {
  it("uses the team's own default counts when a set has no override", () => {
    expect(resolveTeamCapacities(catalog, null)).toEqual({
      DRUMS: 1,
      SOUND_BOOTH: 2,
    });
  });

  it("lets a set's override win role by role", () => {
    const resolved = resolveTeamCapacities(catalog, { SOUND_BOOTH: 0 });
    expect(resolved.SOUND_BOOTH).toBe(0); // "not on this set"
    expect(resolved.DRUMS).toBe(1); // untouched → the team's default
  });

  it("ignores an override for a role this team doesn't have", () => {
    // e.g. a shape saved before the team dropped the role.
    expect(resolveTeamCapacities(catalog, { KEYS: 3 })).not.toHaveProperty("KEYS");
  });

  it("never includes choir — it has no slot count", () => {
    expect(resolveTeamCapacities(catalog, null)).not.toHaveProperty(CHOIR_KEY);
  });
});

describe("roleLabel", () => {
  it("prefers the team's own label", () => {
    const renamed: TeamRoleDef[] = [
      { key: "VOCALS", label: "Backing Vocals", defaultCount: 2, adminOnly: false, order: 0 },
    ];
    expect(roleLabel("VOCALS", renamed)).toBe("Backing Vocals");
  });

  it("falls back to the built-in name without a catalog", () => {
    expect(roleLabel("VOCALS")).toBe("Vox");
  });

  it("humanizes an unknown key so a custom role never renders blank", () => {
    expect(roleLabel("SOUND_BOOTH")).toBe("Sound Booth");
    // A role the team has since deleted still reads correctly in old history.
    expect(roleLabel("LIGHTING_DESK")).toBe("Lighting Desk");
  });
});

describe("roleKeyFromLabel", () => {
  it("uppercases and underscores the name", () => {
    expect(roleKeyFromLabel("Sound Booth")).toBe("SOUND_BOOTH");
  });

  it("lands casing/spacing variants on the same key", () => {
    expect(roleKeyFromLabel("  sound   booth ")).toBe(
      roleKeyFromLabel("Sound Booth")
    );
  });

  it("strips punctuation without leaving stray underscores", () => {
    expect(roleKeyFromLabel("A/V")).toBe("A_V");
    expect(roleKeyFromLabel("Lead — Guitar!")).toBe("LEAD_GUITAR");
  });
});

describe("validateCatalog", () => {
  const ok = (roles: unknown) => {
    const res = validateCatalog(roles);
    if ("error" in res) throw new Error(`unexpected error: ${res.error}`);
    return res.roles;
  };

  it("derives a key for a new role and keeps the one an existing role sends", () => {
    const roles = ok([
      { label: "Sound Booth", defaultCount: 1, adminOnly: false },
      { key: "VOCALS", label: "Backing Vocals", defaultCount: 2, adminOnly: false },
    ]);
    expect(roles[0].key).toBe("SOUND_BOOTH");
    // A rename keeps the key, so every existing slot still points at it.
    expect(roles[1]).toMatchObject({ key: "VOCALS", label: "Backing Vocals" });
  });

  it("numbers the roles by their position in the submitted list", () => {
    const roles = ok([
      { key: "BASS", label: "Bass", defaultCount: 1, adminOnly: false },
      { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false },
    ]);
    expect(roles.map((r) => r.order)).toEqual([0, 1]);
  });

  it("defaults adminOnly to false", () => {
    expect(ok([{ label: "Drums", defaultCount: 1 }])[0].adminOnly).toBe(false);
  });

  it("rejects an empty catalog", () => {
    expect(validateCatalog([])).toEqual({
      error: "A team needs at least one role.",
    });
  });

  it("rejects a nameless role", () => {
    expect(validateCatalog([{ label: "  ", defaultCount: 1 }])).toEqual({
      error: "Every role needs a name.",
    });
  });

  it("rejects two roles that would collide on one key", () => {
    const res = validateCatalog([
      { label: "Sound Booth", defaultCount: 1 },
      { label: "sound booth", defaultCount: 1 },
    ]);
    expect("error" in res && res.error).toMatch(/share the key/);
  });

  it("rejects a name with nothing usable in it", () => {
    const res = validateCatalog([{ label: "!!!", defaultCount: 1 }]);
    expect("error" in res && res.error).toMatch(/letter or number/);
  });

  it("rejects counts outside 0..MAX", () => {
    for (const defaultCount of [-1, 1.5, MAX_SLOTS_PER_ROLE + 1]) {
      const res = validateCatalog([{ label: "Drums", defaultCount }]);
      expect("error" in res && res.error).toMatch(/between 0 and/);
    }
  });

  it("accepts 0 — the role exists but seats nobody by default", () => {
    expect(ok([{ label: "Strings", defaultCount: 0 }])[0].defaultCount).toBe(0);
  });
});
