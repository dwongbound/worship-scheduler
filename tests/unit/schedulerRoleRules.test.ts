// How the ROLE-SHAPED rules change the fill (lib/scheduler.ts reading
// lib/schedulingRules.ts resolveRoleBehavior). These three replaced hardcoded
// behaviour in lib/constants.ts, so the contract that matters most is the
// FALLBACK: an org with no such rules must schedule exactly as it did before
// they existed. Each block checks the built-in default first, then what a rule
// changes, then what switching one OFF does.
import { describe, expect, it } from "vitest";
import {
  buildSchedule,
  type SchedulerSet,
  type SchedulerUser,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import type { RuleParams, RuleTier, SchedulingRule } from "@/lib/schedulingRules";
import type { TeamRoleDef } from "@/lib/teamRoles";

const TEAM = "team-1";
const TEAM_B = "team-2";
const TZ = "America/Los_Angeles";
const SUN = new Date(2026, 0, 11, 9, 0);

let n = 0;
const rule = (
  params: RuleParams,
  opts: { tier?: RuleTier; enabled?: boolean; teamId?: string | null } = {}
): SchedulingRule => ({
  id: `r${++n}`,
  tier: opts.tier ?? "REQUIRED",
  enabled: opts.enabled ?? true,
  params,
  teamId: opts.teamId ?? null,
});

function catalog(keys: string[]): TeamRoleDef[] {
  return keys.map((key, order) => ({
    key,
    label: key,
    defaultCount: 1,
    adminOnly: false,
    order,
  }));
}

function player(
  id: string,
  roles: string[],
  opts: { isMD?: boolean; teams?: Record<string, string[]> } = {}
): SchedulerUser {
  return {
    id,
    isMD: opts.isMD,
    rolesByTeam: opts.teams ?? { [TEAM]: roles },
  };
}

function set(
  id: string,
  roles: string[],
  extra: Partial<SchedulerSet> = {}
): SchedulerSet {
  return {
    id,
    startsAt: SUN,
    durationMinutes: 60,
    teamId: TEAM,
    roles: catalog(roles),
    ...extra,
  };
}

const run = (
  sets: SchedulerSet[],
  users: SchedulerUser[],
  schedulingRules: SchedulingRule[],
  unavailable: UnavailabilityRule[] = []
) =>
  buildSchedule(sets, users, unavailable, new Map(), [], new Map(), {
    schedulingRules,
    timeZone: TZ,
  });

const roleOf = (
  result: { userId: string; role: string }[],
  userId: string
): string | undefined => result.find((a) => a.userId === userId)?.role;

// ── LEADS_FROM ────────────────────────────────────────────────────────────
// Which roles count as leading, and so where a required-MD set reserves a seat.

describe("LEADS_FROM", () => {
  // The MD seat is only RESERVED when the freely-filled roster turns out to
  // have nobody who could lead (lib/scheduler.ts fills on rotation first). And
  // the retry only runs at all when the team keeps an "MD" role in its catalog
  // — teamSupportsMD — so every set here carries one.
  const mdSet = (roles: string[], extra: Partial<SchedulerSet> = {}) =>
    set("s", [...roles, "MD"], { requiresMD: true, ...extra });

  it("makes a role that never led count as leading", () => {
    // Rotation seats the director in DRUMS (first in fill order). By the
    // built-in list that isn't leading, so the seat is re-reserved and they
    // move to KEYS. Told that DRUMS leads, the first roster already stands.
    const people = [player("md", ["DRUMS", "KEYS"], { isMD: true })];
    const sets = () => [mdSet(["DRUMS", "KEYS"])];

    expect(roleOf(run(sets(), people, []), "md")).toBe("KEYS");
    expect(
      roleOf(run(sets(), people, [rule({ kind: "LEADS_FROM", roles: ["DRUMS"] })]), "md")
    ).toBe("DRUMS");
  });

  it("decides which role the reserved seat goes to", () => {
    // The director plays keys and bass; drums is covered by someone else.
    // By the built-in order keys leads, so the first fill already works. Told
    // that only BASS leads, the roster can't lead and the seat moves there.
    const people = [
      player("md", ["KEYS", "BASS"], { isMD: true }),
      player("d1", ["DRUMS"]),
    ];
    const sets = () => [mdSet(["DRUMS", "KEYS", "BASS"])];

    expect(roleOf(run(sets(), people, []), "md")).toBe("KEYS");
    expect(
      roleOf(run(sets(), people, [rule({ kind: "LEADS_FROM", roles: ["BASS"] })]), "md")
    ).toBe("BASS");
  });

  it("a director who plays nothing on the list doesn't get a reserved seat", () => {
    const result = run(
      [mdSet(["DRUMS", "ELECTRIC_GUITAR"])],
      [
        player("md", ["DRUMS"], { isMD: true }),
        player("g1", ["ELECTRIC_GUITAR"]),
      ],
      [rule({ kind: "LEADS_FROM", roles: ["ELECTRIC_GUITAR"] })]
    );
    // They still play drums on rotation — they just aren't the set's director.
    expect(roleOf(result, "md")).toBe("DRUMS");
    expect(roleOf(result, "g1")).toBe("ELECTRIC_GUITAR");
  });

  it("switched off, nothing counts as leading", () => {
    // No role leads, so the roster can never lead and the reservation has no
    // seat to take — the rotation roster stands as it is.
    const result = run(
      [mdSet(["DRUMS", "KEYS"])],
      [player("md", ["DRUMS", "KEYS"], { isMD: true })],
      [rule({ kind: "LEADS_FROM", roles: ["KEYS"] }, { enabled: false })]
    );
    expect(roleOf(result, "md")).toBe("DRUMS");
  });

  it("scoped to a team, it only governs that team's sets", () => {
    const both = player("md", ["DRUMS", "KEYS"], {
      isMD: true,
      teams: { [TEAM]: ["DRUMS", "KEYS"], [TEAM_B]: ["DRUMS", "KEYS"] },
    });
    const rules = [
      rule({ kind: "LEADS_FROM", roles: ["DRUMS"] }, { teamId: TEAM }),
    ];
    expect(roleOf(run([mdSet(["DRUMS", "KEYS"])], [both], rules), "md")).toBe("DRUMS");
    expect(
      roleOf(
        run([mdSet(["DRUMS", "KEYS"], { id: "b", teamId: TEAM_B })], [both], rules),
        "md"
      )
    ).toBe("KEYS"); // the built-in order, untouched
  });

  it("a team with no MD role in its catalog never reserves a seat", () => {
    // teamSupportsMD gates the whole retry on the catalog keeping "MD", so a
    // LEADS_FROM rule can't resurrect the behaviour for a team that dropped it.
    const result = run(
      [set("s", ["DRUMS", "KEYS"], { requiresMD: true })],
      [player("md", ["DRUMS", "KEYS"], { isMD: true })],
      [rule({ kind: "LEADS_FROM", roles: ["KEYS"] })]
    );
    expect(roleOf(result, "md")).toBe("DRUMS");
  });
});

// ── ROLE_HOST ─────────────────────────────────────────────────────────────
// A role only held by someone already in another role (acoustic, by default).

describe("ROLE_HOST", () => {
  const band = ["WORSHIP_LEADER", "VOCALS", "ACOUSTIC_GUITAR"];

  it("without a rule, acoustic still needs a seated leader or vocalist", () => {
    // The dedicated acoustic player is left out; the worship leader doubles up.
    const result = run(
      [set("s", band)],
      [
        player("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]),
        player("ac", ["ACOUSTIC_GUITAR"]),
      ],
      []
    );
    expect(roleOf(result, "ac")).toBeUndefined();
    expect(
      result.filter((a) => a.userId === "wl").map((a) => a.role).sort()
    ).toEqual(["ACOUSTIC_GUITAR", "WORSHIP_LEADER"]);
  });

  it("switched off, a dedicated player can take the seat", () => {
    const result = run(
      [set("s", band)],
      [
        player("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]),
        player("ac", ["ACOUSTIC_GUITAR"]),
      ],
      [
        rule(
          { kind: "ROLE_HOST", role: "ACOUSTIC_GUITAR", hostRoles: ["WORSHIP_LEADER"] },
          { enabled: false }
        ),
      ]
    );
    expect(roleOf(result, "ac")).toBe("ACOUSTIC_GUITAR");
  });

  it("gives a CUSTOM role the same behaviour the built-in one had", () => {
    // SHAKER is nobody's special case in lib/constants.ts — the rule is the
    // only reason it behaves this way, which is the point of making it data.
    const roles = ["VOCALS", "SHAKER"];
    const rules = [
      rule({ kind: "ROLE_HOST", role: "SHAKER", hostRoles: ["VOCALS"] }),
      // Needed too: holding both is a double-up, which is its own rule.
      rule({ kind: "MAY_DOUBLE", roles: ["VOCALS", "SHAKER"] }),
    ];
    const result = run(
      [set("s", roles)],
      [player("v1", ["VOCALS", "SHAKER"]), player("sh", ["SHAKER"])],
      rules
    );
    expect(roleOf(result, "sh")).toBeUndefined();
    expect(
      result.filter((a) => a.userId === "v1").map((a) => a.role).sort()
    ).toEqual(["SHAKER", "VOCALS"]);
  });

  it("leaves the seat empty when no host plays it", () => {
    const result = run(
      [set("s", ["VOCALS", "SHAKER"])],
      [player("v1", ["VOCALS"]), player("sh", ["SHAKER"])],
      [rule({ kind: "ROLE_HOST", role: "SHAKER", hostRoles: ["VOCALS"] })]
    );
    expect(result.some((a) => a.role === "SHAKER")).toBe(false);
  });

  it("governs only the role it names", () => {
    // A rule about SHAKER must not free acoustic from its built-in default.
    const result = run(
      [set("s", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR", "SHAKER"])],
      [
        player("wl", ["WORSHIP_LEADER"]),
        player("ac", ["ACOUSTIC_GUITAR"]),
      ],
      [rule({ kind: "ROLE_HOST", role: "SHAKER", hostRoles: ["VOCALS"] })]
    );
    expect(roleOf(result, "ac")).toBeUndefined();
  });
});

// ── MAY_DOUBLE ────────────────────────────────────────────────────────────
// Which two roles one person may hold on the same set.

describe("MAY_DOUBLE", () => {
  it("without a rule, the built-in pairs still double up", () => {
    const result = run(
      [set("s", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"])],
      [player("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"])],
      []
    );
    expect(result).toHaveLength(2);
  });

  it("switched off, that pair is one person each", () => {
    const result = run(
      [set("s", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"])],
      [player("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"])],
      [
        rule(
          { kind: "MAY_DOUBLE", roles: ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"] },
          { enabled: false }
        ),
      ]
    );
    // Only one seat: acoustic needs a seated host, and the host may no longer
    // also hold it.
    expect(result).toHaveLength(1);
  });

  it("a new pair lets one person hold both", () => {
    const result = run(
      [set("s", ["KEYS", "VOCALS"])],
      [player("k1", ["KEYS", "VOCALS"])],
      [rule({ kind: "MAY_DOUBLE", roles: ["KEYS", "VOCALS"] })]
    );
    expect(result.map((a) => a.role).sort()).toEqual(["KEYS", "VOCALS"]);
  });

  it("without that rule, one person does NOT hold both", () => {
    const result = run(
      [set("s", ["KEYS", "VOCALS"])],
      [player("k1", ["KEYS", "VOCALS"])],
      []
    );
    expect(result).toHaveLength(1);
  });

  it("is unordered — naming the pair either way is the same rule", () => {
    const result = run(
      [set("s", ["KEYS", "VOCALS"])],
      [player("k1", ["KEYS", "VOCALS"])],
      [rule({ kind: "MAY_DOUBLE", roles: ["VOCALS", "KEYS"] })]
    );
    expect(result).toHaveLength(2);
  });
});

// ── Interactions ──────────────────────────────────────────────────────────
// The role rules don't live alone: they share a fill with the person rules and
// with availability.

describe("role rules alongside the rest", () => {
  it("a required NEVER still applies to a hosted role's host", () => {
    // v1 would host the shaker seat, but is barred from serving with d1 who is
    // already on the set — so neither the host nor the hosted seat is filled.
    const result = run(
      [set("s", ["DRUMS", "VOCALS", "SHAKER"])],
      [
        player("d1", ["DRUMS"]),
        player("v1", ["VOCALS", "SHAKER"]),
      ],
      [
        rule({ kind: "ROLE_HOST", role: "SHAKER", hostRoles: ["VOCALS"] }),
        rule({ kind: "MAY_DOUBLE", roles: ["VOCALS", "SHAKER"] }),
        rule({ kind: "TOGETHER", mode: "NEVER", userIds: ["d1", "v1"] }),
      ]
    );
    expect(result.map((a) => a.role)).toEqual(["DRUMS"]);
  });

  it("an unavailable director doesn't get the reserved seat", () => {
    const result = run(
      [set("s", ["ELECTRIC_GUITAR", "KEYS"], { requiresMD: true })],
      [
        player("md", ["ELECTRIC_GUITAR"], { isMD: true }),
        player("k1", ["KEYS"]),
      ],
      [rule({ kind: "LEADS_FROM", roles: ["ELECTRIC_GUITAR"] })],
      [
        {
          userId: "md",
          type: "DATE_RANGE",
          startDate: new Date(2026, 0, 11),
          endDate: new Date(2026, 0, 11),
        },
      ]
    );
    expect(result.some((a) => a.userId === "md")).toBe(false);
  });

  it("a preference can't bend a role rule — they're required by construction", () => {
    // Tier is forced on these kinds, so a PREFERENCE-tier row still behaves as
    // the structural rule it is rather than quietly becoming optional.
    const result = run(
      [set("s", ["KEYS", "VOCALS"])],
      [player("k1", ["KEYS", "VOCALS"])],
      [rule({ kind: "MAY_DOUBLE", roles: ["KEYS", "VOCALS"] }, { tier: "PREFERENCE" })]
    );
    expect(result).toHaveLength(2);
  });

  it("the whole fill is unchanged when an org has no rules at all", () => {
    const sets = [set("s", ["WORSHIP_LEADER", "VOCALS", "ACOUSTIC_GUITAR", "DRUMS"])];
    const people = [
      player("wl", ["WORSHIP_LEADER", "ACOUSTIC_GUITAR"]),
      player("v1", ["VOCALS"]),
      player("d1", ["DRUMS"]),
    ];
    // The baseline this whole feature promises not to disturb.
    expect(run(sets, people, []).map((a) => `${a.userId}:${a.role}`).sort()).toEqual([
      "d1:DRUMS",
      "v1:VOCALS",
      "wl:ACOUSTIC_GUITAR",
      "wl:WORSHIP_LEADER",
    ]);
  });
});
