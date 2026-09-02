// Unit tests for lib/setStatus — the set's overall status (calendar dot +
// filters), derived from BOTH how full the roster is and what state the people
// on it are in.
import { describe, expect, it } from "vitest";
import { openSlotCount, setStatus } from "@/lib/setStatus";
import type { AssignmentStatus } from "@/lib/constants";
import type { TeamRoleDef } from "@/lib/teamRoles";

// A two-role team wanting one of each — small enough that "full" and "has a
// hole" are both one line away.
const CATALOG: TeamRoleDef[] = [
  { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 0 },
  { key: "BASS", label: "Bass", defaultCount: 1, adminOnly: false, order: 1 },
];

/**
 * A set of this two-role team, staffed by the given [role, status] pairs.
 * Anything not listed is an open slot.
 */
function set(...people: [string, AssignmentStatus][]) {
  return {
    assignments: people.map(([role, status]) => ({ role, status })),
    slotCapacities: null,
    team: { roles: CATALOG },
  };
}

/** The same set, but full — one drummer and one bassist. */
function full(drums: AssignmentStatus, bass: AssignmentStatus) {
  return set(["DRUMS", drums], ["BASS", bass]);
}

// ── Guest teams ─────────────────────────────────────────────────────────────
// A set can borrow another team's people. Counted guest seats are holes like
// any other; an "as many as available" seat has no target, so it never is.
describe("openSlotCount with guest teams", () => {
  // The two-role team above, fully staffed, plus one guest team's seats.
  const withGuest = (
    roles: { role: string; count?: number; allAvailable?: true }[],
    guests: string[] = []
  ) => ({
    assignments: [
      { role: "DRUMS", status: "CONFIRMED" as AssignmentStatus },
      { role: "BASS", status: "CONFIRMED" as AssignmentStatus },
      ...guests.map((role) => ({
        role,
        status: "CONFIRMED" as AssignmentStatus,
        guestTeamId: "g1",
      })),
    ],
    slotCapacities: null,
    team: { roles: CATALOG },
    guestTeams: [
      { id: "g1", teamId: "team-guest", roles: roles as never },
    ],
  });

  it("counts a counted guest role's unfilled seats", () => {
    expect(openSlotCount(withGuest([{ role: "CHOIR", count: 3 }]))).toBe(3);
    expect(
      openSlotCount(withGuest([{ role: "CHOIR", count: 3 }], ["CHOIR", "CHOIR"]))
    ).toBe(1);
  });

  it("never counts an 'as many as available' guest role as a hole", () => {
    // The behaviour the old opt-in choir had, now generic: no target number,
    // so an empty one can't make the set read understaffed.
    expect(
      openSlotCount(withGuest([{ role: "CHOIR", allAvailable: true }]))
    ).toBe(0);
    expect(
      openSlotCount(withGuest([{ role: "CHOIR", allAvailable: true }], ["CHOIR"]))
    ).toBe(0);
  });

  it("doesn't let a guest seat fill the owning team's same-named slot", () => {
    // Both teams have DRUMS; a guest drummer must not satisfy the host's slot.
    const set = {
      assignments: [
        { role: "DRUMS", status: "CONFIRMED" as AssignmentStatus, guestTeamId: "g1" },
      ],
      slotCapacities: null,
      team: { roles: CATALOG },
      guestTeams: [
        { id: "g1", teamId: "team-guest", roles: [{ role: "DRUMS", count: 1 }] as never },
      ],
    };
    // The host's own drums + bass are both still open; the guest seat is full.
    expect(openSlotCount(set)).toBe(2);
  });

  it("is unchanged for a set with no guest teams", () => {
    expect(openSlotCount({ ...full("CONFIRMED", "CONFIRMED"), guestTeams: [] })).toBe(0);
  });
});

describe("openSlotCount", () => {
  it("counts every unfilled slot in the team's shape", () => {
    expect(openSlotCount(set())).toBe(2);
    expect(openSlotCount(set(["DRUMS", "CONFIRMED"]))).toBe(1);
    expect(openSlotCount(full("CONFIRMED", "CONFIRMED"))).toBe(0);
  });

  it("honours a per-set capacity override", () => {
    const s = {
      assignments: [{ role: "DRUMS", status: "CONFIRMED" as AssignmentStatus }],
      slotCapacities: { DRUMS: 2, BASS: 0 },
      team: { roles: CATALOG },
    };
    expect(openSlotCount(s)).toBe(1); // the second drummer
  });

  it("never goes negative when a role is over-filled", () => {
    expect(
      openSlotCount(
        set(["DRUMS", "CONFIRMED"], ["DRUMS", "CONFIRMED"], ["BASS", "CONFIRMED"])
      )
    ).toBe(0);
  });
});

describe("setStatus", () => {
  it("is understaffed when nobody is assigned", () => {
    expect(setStatus(set())).toBe("understaffed");
  });

  it("is understaffed while any slot is still open", () => {
    expect(setStatus(set(["DRUMS", "CONFIRMED"]))).toBe("understaffed");
  });

  it("is confirmed only when the roster is full and everyone confirmed", () => {
    expect(setStatus(full("CONFIRMED", "CONFIRMED"))).toBe("confirmed");
  });

  it("is unconfirmed when a full roster has a slot pending confirmation", () => {
    expect(setStatus(full("CONFIRMED", "PENDING"))).toBe("unconfirmed");
  });

  it("is unconfirmed when a full roster has a slot pending admin approval", () => {
    expect(setStatus(full("CONFIRMED", "PENDING_APPROVAL"))).toBe("unconfirmed");
  });

  it("is cover when any slot is a cover request", () => {
    expect(setStatus(full("CONFIRMED", "SWAP_REQUESTED"))).toBe("cover");
  });

  it("cover outranks an open slot — someone asked out, which needs answering", () => {
    expect(setStatus(set(["DRUMS", "SWAP_REQUESTED"]))).toBe("cover");
  });

  it("an open slot outranks a pending confirmation", () => {
    expect(setStatus(set(["DRUMS", "PENDING"]))).toBe("understaffed");
  });

  it("falls back to the built-in roles when the team catalog is absent", () => {
    // No team + no assignments is still a hole, whatever the default shape is.
    expect(setStatus({ assignments: [] })).toBe("understaffed");
  });
});
