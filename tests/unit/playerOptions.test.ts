// The assignment dropdown's candidate list (lib/playerOptions): who shows up,
// how they're flagged, and in what order. The key rule for inactive members is
// that they stay PICKABLE — an admin can override — but read as "(inactive)"
// and sink below everyone who's actually schedulable.
import { describe, expect, it } from "vitest";
import { buildPlayerOptions, type CandidateUser } from "@/lib/playerOptions";
import type { UnavailabilityRule } from "@/lib/scheduler";
import type { Instrument } from "@/lib/constants";

const TEAM = "team-sunday";

// Sunday Jan 4 2026, 9–10:30am.
const set = {
  id: "set-1",
  startsAt: new Date("2026-01-04T09:00:00"),
  durationMinutes: 90,
  teamId: TEAM,
};

function drummer(
  id: string,
  name: string,
  active = true,
  teamId = TEAM
): CandidateUser {
  return {
    id,
    name,
    teams: [{ id: teamId, roles: ["DRUMS"] as Instrument[], active }],
  };
}

const opts = (users: CandidateUser[], rules: UnavailabilityRule[] = []) =>
  buildPlayerOptions({
    users,
    role: "DRUMS",
    teamId: TEAM,
    set,
    rules,
    exclude: new Set<string>(),
  });

describe("buildPlayerOptions — inactive members", () => {
  it("still lists an inactive person, flagged inactive", () => {
    const [row] = opts([drummer("d1", "Dana", false)]);
    expect(row.id).toBe("d1");
    expect(row.inactive).toBe(true);
    // Availability is a separate axis: they're free, just paused.
    expect(row.available).toBe(true);
  });

  it("does not flag an active person", () => {
    expect(opts([drummer("d1", "Dana")])[0].inactive).toBe(false);
  });

  it("sorts inactive people below active ones", () => {
    // Names chosen so alphabetical order would put the inactive one FIRST.
    const rows = opts([drummer("d1", "Ada", false), drummer("d2", "Zoe")]);
    expect(rows.map((r) => r.id)).toEqual(["d2", "d1"]);
  });

  it("sorts unavailable people below inactive ones (availability wins)", () => {
    const rules: UnavailabilityRule[] = [
      // Blocks Sunday mornings for the otherwise-active drummer.
      { userId: "d2", type: "RECURRING", dayOfWeek: 0, startMinute: 480, endMinute: 720 },
    ];
    const rows = opts([drummer("d1", "Ada", false), drummer("d2", "Zoe")], rules);
    expect(rows.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(rows[1].available).toBe(false);
  });

  it("is per team — active here, paused on another team", () => {
    const paulOnTwo: CandidateUser = {
      id: "d1",
      name: "Dana",
      teams: [
        { id: TEAM, roles: ["DRUMS"], active: true },
        { id: "team-prayer", roles: ["DRUMS"], active: false },
      ],
    };
    expect(opts([paulOnTwo])[0].inactive).toBe(false);
    expect(
      buildPlayerOptions({
        users: [paulOnTwo],
        role: "DRUMS",
        teamId: "team-prayer",
        set: { ...set, teamId: "team-prayer" },
        rules: [],
        exclude: new Set<string>(),
      })[0].inactive
    ).toBe(true);
  });

  it("treats a membership with no flag as active (pre-flag data)", () => {
    const legacy: CandidateUser = {
      id: "d1",
      name: "Dana",
      teams: [{ id: TEAM, roles: ["DRUMS"] }],
    };
    expect(opts([legacy])[0].inactive).toBe(false);
  });
});

describe("buildPlayerOptions — the rest of the list", () => {
  it("omits people who don't play the role on this team", () => {
    const bassist: CandidateUser = {
      id: "b1",
      name: "Bo",
      teams: [{ id: TEAM, roles: ["BASS"], active: true }],
    };
    expect(opts([drummer("d1", "Dana"), bassist]).map((r) => r.id)).toEqual([
      "d1",
    ]);
  });

  it("omits excluded people (already in this slot)", () => {
    const rows = buildPlayerOptions({
      users: [drummer("d1", "Dana"), drummer("d2", "Zoe")],
      role: "DRUMS",
      teamId: TEAM,
      set,
      rules: [],
      exclude: new Set(["d1"]),
    });
    expect(rows.map((r) => r.id)).toEqual(["d2"]);
  });

  it("breaks ties on serve count, then name", () => {
    const rows = buildPlayerOptions({
      users: [drummer("d1", "Ada"), drummer("d2", "Zoe"), drummer("d3", "Bea")],
      role: "DRUMS",
      teamId: TEAM,
      set,
      rules: [],
      exclude: new Set<string>(),
      serveCounts: new Map([["d1", 3]]),
    });
    // Ada is busiest so she drops last, despite the alphabet.
    expect(rows.map((r) => r.name)).toEqual(["Bea", "Zoe", "Ada"]);
    expect(rows[2].count).toBe(3);
  });

  it("only marks MD when the caller asks", () => {
    const plain = opts([drummer("d1", "Dana")]);
    expect(plain[0].md).toBeUndefined();
    const withMd = buildPlayerOptions({
      users: [drummer("d1", "Dana")],
      role: "DRUMS",
      teamId: TEAM,
      set,
      rules: [],
      exclude: new Set<string>(),
      isMDHere: () => true,
    });
    expect(withMd[0].md).toBe(true);
  });
});
