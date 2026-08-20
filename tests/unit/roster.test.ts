// The per-team "active" flag, end to end through the pure layer:
//   - an inactive member is dropped from the scheduler's pool, so buildSchedule
//     never proposes them (lib/roster + lib/scheduler);
//   - the swap picker still lists them, flagged inactive (lib/roster).
import { describe, expect, it } from "vitest";
import { inactiveMemberIds, schedulableRolesByTeam } from "@/lib/roster";
import { buildSchedule, type SchedulerSet } from "@/lib/scheduler";
import type { Instrument } from "@/lib/constants";

const TEAM = "team-sunday";
const OTHER_TEAM = "team-prayer";

// One Sunday set for the team, 9am, needing the default team shape.
const sundaySet: SchedulerSet = {
  id: "set-1",
  startsAt: new Date("2026-01-04T09:00:00"), // Sun Jan 4 2026
  durationMinutes: 90,
  teamId: TEAM,
};

describe("schedulableRolesByTeam", () => {
  it("keeps an active membership's roles", () => {
    expect(
      schedulableRolesByTeam([
        { teamId: TEAM, roles: ["DRUMS"], active: true },
      ])
    ).toEqual({ [TEAM]: ["DRUMS"] });
  });

  it("drops an inactive membership entirely", () => {
    expect(
      schedulableRolesByTeam([
        { teamId: TEAM, roles: ["DRUMS"], active: false },
      ])
    ).toEqual({});
  });

  it("is per team — paused on one, schedulable on the other", () => {
    expect(
      schedulableRolesByTeam([
        { teamId: TEAM, roles: ["DRUMS"], active: false },
        { teamId: OTHER_TEAM, roles: ["DRUMS"], active: true },
      ])
    ).toEqual({ [OTHER_TEAM]: ["DRUMS"] });
  });
});

describe("the auto-scheduler skips inactive members", () => {
  // Two drummers, identical except that one has been switched off on the team.
  const active = {
    id: "dr-active",
    rolesByTeam: schedulableRolesByTeam([
      { teamId: TEAM, roles: ["DRUMS"] as Instrument[], active: true },
    ]),
  };
  const inactive = {
    id: "dr-inactive",
    rolesByTeam: schedulableRolesByTeam([
      { teamId: TEAM, roles: ["DRUMS"] as Instrument[], active: false },
    ]),
  };

  it("never proposes the inactive drummer", () => {
    const proposals = buildSchedule([sundaySet], [active, inactive], []);
    const drums = proposals.filter((p) => p.role === "DRUMS");
    expect(drums).toHaveLength(1);
    expect(drums[0].userId).toBe("dr-active");
  });

  it("leaves the slot EMPTY rather than falling back to them", () => {
    // The inactive drummer is the only one who plays drums.
    const proposals = buildSchedule([sundaySet], [inactive], []);
    expect(proposals.filter((p) => p.role === "DRUMS")).toEqual([]);
  });

  it("still schedules them on a team they're active on", () => {
    const both = {
      id: "dr-both",
      rolesByTeam: schedulableRolesByTeam([
        { teamId: TEAM, roles: ["DRUMS"] as Instrument[], active: false },
        { teamId: OTHER_TEAM, roles: ["DRUMS"] as Instrument[], active: true },
      ]),
    };
    const otherTeamSet = { ...sundaySet, id: "set-2", teamId: OTHER_TEAM };
    expect(
      buildSchedule([otherTeamSet], [both], []).some(
        (p) => p.userId === "dr-both" && p.role === "DRUMS"
      )
    ).toBe(true);
    expect(
      buildSchedule([sundaySet], [both], []).some((p) => p.userId === "dr-both")
    ).toBe(false);
  });

  it("keeps them off a team-less (org-wide) set when every team is paused", () => {
    const teamlessSet = { ...sundaySet, id: "set-3", teamId: null };
    expect(buildSchedule([teamlessSet], [inactive], [])).toEqual([]);
    expect(
      buildSchedule([teamlessSet], [active], []).some(
        (p) => p.userId === "dr-active"
      )
    ).toBe(true);
  });
});

describe("inactiveMemberIds", () => {
  it("flags a member whose only membership is switched off", () => {
    expect(
      inactiveMemberIds([{ userId: "u1", active: false }])
    ).toEqual(new Set(["u1"]));
  });

  it("does not flag an active member", () => {
    expect(inactiveMemberIds([{ userId: "u1", active: true }]).size).toBe(0);
  });

  it("needs EVERY membership off before flagging (org-wide sets)", () => {
    const ids = inactiveMemberIds([
      { userId: "u1", active: false },
      { userId: "u1", active: true },
      { userId: "u2", active: false },
      { userId: "u2", active: false },
    ]);
    expect(ids.has("u1")).toBe(false);
    expect(ids.has("u2")).toBe(true);
  });

  it("ignores people with no membership row at all", () => {
    // "Not on the team" isn't "paused" — they simply aren't in the input.
    expect(inactiveMemberIds([]).size).toBe(0);
  });
});
