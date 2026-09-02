// Unit tests for guest teams (lib/guestTeams.ts) — the rules behind borrowing
// another team's people for one set.
import { describe, expect, it } from "vitest";
import {
  isUnbounded,
  openSeats,
  usersOnSet,
  validateGuestRoles,
  type GuestRoleSpec,
} from "@/lib/guestTeams";
import { MAX_SLOTS_PER_ROLE } from "@/lib/constants";

const CATALOG = ["CHOIR", "VOCALS", "DRUMS"];

describe("isUnbounded", () => {
  it("is true only for an allAvailable seat", () => {
    expect(isUnbounded({ role: "CHOIR", allAvailable: true })).toBe(true);
    expect(isUnbounded({ role: "CHOIR", count: 4 })).toBe(false);
  });
});

describe("openSeats", () => {
  it("counts a fixed role's unfilled slots", () => {
    expect(openSeats({ role: "CHOIR", count: 4 }, 1)).toBe(3);
    expect(openSeats({ role: "CHOIR", count: 4 }, 4)).toBe(0);
  });

  it("never goes negative when a role is overfilled", () => {
    // e.g. the count was lowered after people were already seated.
    expect(openSeats({ role: "CHOIR", count: 2 }, 5)).toBe(0);
  });

  it("reports zero for an unbounded seat, however many are on it", () => {
    // This is what stops an "as many as available" choir from ever making a
    // set read understaffed — there's no target to fall short of.
    const spec: GuestRoleSpec = { role: "CHOIR", allAvailable: true };
    expect(openSeats(spec, 0)).toBe(0);
    expect(openSeats(spec, 12)).toBe(0);
  });
});

describe("validateGuestRoles", () => {
  it("accepts counted and unbounded seats together", () => {
    expect(
      validateGuestRoles(
        [
          { role: "CHOIR", allAvailable: true },
          { role: "VOCALS", count: 2 },
        ],
        CATALOG
      )
    ).toEqual([
      { role: "CHOIR", allAvailable: true },
      { role: "VOCALS", count: 2 },
    ]);
  });

  it("rejects a role the guest team doesn't have", () => {
    // Roles are per-team, so a set may only borrow what that team offers.
    expect(validateGuestRoles([{ role: "BAGPIPES", count: 1 }], CATALOG)).toBeNull();
  });

  it("rejects a non-array, a non-object entry, and a missing role", () => {
    expect(validateGuestRoles("nope", CATALOG)).toBeNull();
    expect(validateGuestRoles([null], CATALOG)).toBeNull();
    expect(validateGuestRoles([{ count: 2 }], CATALOG)).toBeNull();
  });

  it("rejects a count that isn't a whole number in range", () => {
    expect(validateGuestRoles([{ role: "CHOIR", count: -1 }], CATALOG)).toBeNull();
    expect(validateGuestRoles([{ role: "CHOIR", count: 1.5 }], CATALOG)).toBeNull();
    expect(
      validateGuestRoles([{ role: "CHOIR", count: MAX_SLOTS_PER_ROLE + 1 }], CATALOG)
    ).toBeNull();
  });

  it("allows a zero count (the editor's 'borrowed but no seats yet')", () => {
    expect(validateGuestRoles([{ role: "CHOIR", count: 0 }], CATALOG)).toEqual([
      { role: "CHOIR", count: 0 },
    ]);
  });

  it("collapses a duplicated role to its last entry", () => {
    // A double-tick must not create two seats for one role.
    expect(
      validateGuestRoles(
        [
          { role: "CHOIR", count: 2 },
          { role: "CHOIR", allAvailable: true },
        ],
        CATALOG
      )
    ).toEqual([{ role: "CHOIR", allAvailable: true }]);
  });

  it("takes allAvailable over a count on the same entry", () => {
    expect(
      validateGuestRoles([{ role: "CHOIR", allAvailable: true, count: 3 }], CATALOG)
    ).toEqual([{ role: "CHOIR", allAvailable: true }]);
  });
});

describe("usersOnSet", () => {
  it("collects every assigned user id, de-duplicated across roles", () => {
    // One person may hold two roles; they're still one busy person.
    expect(
      usersOnSet([{ userId: "u1" }, { userId: "u2" }, { userId: "u1" }])
    ).toEqual(new Set(["u1", "u2"]));
  });
});
