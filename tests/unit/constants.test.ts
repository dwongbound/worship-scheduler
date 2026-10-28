// Unit tests for the slot-capacity helpers (lib/constants.ts): the API-input
// validator, plus the built-in role list that seeds every new team's catalog.
// The per-team shape resolver lives in lib/teamRoles.ts (teamRoles.test.ts).
import { describe, expect, it } from "vitest";
import {
  ALL_INSTRUMENTS,
  CHOIR,
  DAY_INITIALS,
  DAY_LABELS,
  INSTRUMENT_LABELS,
  MAX_SLOTS_PER_ROLE,
  ROLE_ORDER,
  SLOT_CAPACITIES,
  validateSlotCapacities,
} from "@/lib/constants";

describe("validateSlotCapacities", () => {
  it("accepts a well-formed role→count map", () => {
    const map = { ELECTRIC_GUITAR: 2, ACOUSTIC_GUITAR: 0 };
    expect(validateSlotCapacities(map)).toEqual(map);
  });

  it("rejects keys outside the team's catalog when one is given", () => {
    const allowed = ["DRUMS", "BASS"];
    expect(validateSlotCapacities({ TRUMPET: 1 }, allowed)).toBeNull();
    expect(validateSlotCapacities({ DRUMS: 1 }, allowed)).toEqual({ DRUMS: 1 });
  });

  it("accepts a custom role key when the catalog allows it", () => {
    // Roles are per-team now, so there's no fixed vocabulary to check against.
    const map = { SOUND_BOOTH: 2 };
    expect(validateSlotCapacities(map, ["SOUND_BOOTH"])).toEqual(map);
  });

  it("rejects negative, non-integer, or over-cap values", () => {
    expect(validateSlotCapacities({ DRUMS: -1 })).toBeNull();
    expect(validateSlotCapacities({ DRUMS: 1.5 })).toBeNull();
    expect(validateSlotCapacities({ DRUMS: MAX_SLOTS_PER_ROLE + 1 })).toBeNull();
  });

  it("rejects non-object inputs", () => {
    expect(validateSlotCapacities(null)).toBeNull();
    expect(validateSlotCapacities([1, 2])).toBeNull();
    expect(validateSlotCapacities("VOCALS")).toBeNull();
  });

  it("rejects CHOIR — it has no slot count and never belongs in a team shape", () => {
    // Enforced by the catalog the caller passes: choir is never a band role.
    const bandOnly = ["VOCALS", "DRUMS"];
    expect(validateSlotCapacities({ CHOIR: 2 }, bandOnly)).toBeNull();
    expect(validateSlotCapacities({ VOCALS: 2, CHOIR: 1 }, bandOnly)).toBeNull();
  });
});

describe("choir role", () => {
  it("is a selectable role with a label but not a band/capacity role", () => {
    expect(ALL_INSTRUMENTS).toContain(CHOIR);
    expect(INSTRUMENT_LABELS[CHOIR]).toBe("Choir");
    // Choir has no slot count, so it stays out of the capacity-only lists.
    expect(ROLE_ORDER).not.toContain(CHOIR);
    expect(Object.keys(SLOT_CAPACITIES)).not.toContain(CHOIR);
  });

  it("lists every band role plus choir, choir last", () => {
    expect(ALL_INSTRUMENTS).toEqual([...ROLE_ORDER, CHOIR]);
  });
});

describe("day initials", () => {
  // The weekly set time form fits all seven days across a phone by showing
  // these instead of the full names. Two letters is the narrowest spelling
  // that still tells the days apart, so the properties worth pinning are
  // "one per day", "each really abbreviates its own day", and "all distinct".
  it("gives one abbreviation per day, in the same order as the full names", () => {
    expect(DAY_INITIALS).toHaveLength(DAY_LABELS.length);
    DAY_INITIALS.forEach((short, i) => {
      expect({ i, starts: DAY_LABELS[i].startsWith(short) }).toEqual({
        i,
        starts: true,
      });
    });
  });

  it("tells every day apart — which single letters would not", () => {
    expect(new Set(DAY_INITIALS).size).toBe(7);
    // The reason this isn't just DAY_LABELS[i][0]: S, T and S repeat.
    const firstLetters = DAY_LABELS.map((d) => d[0]);
    expect(new Set(firstLetters).size).toBeLessThan(7);
  });
});
