// Unit tests for the slot-capacity helpers (lib/constants.ts): the per-set
// team-shape resolver and the API-input validator.
import { describe, expect, it } from "vitest";
import {
  ALL_INSTRUMENTS,
  CHOIR,
  INSTRUMENT_LABELS,
  MAX_SLOTS_PER_ROLE,
  ROLE_ORDER,
  SLOT_CAPACITIES,
  resolveCapacities,
  validateSlotCapacities,
} from "@/lib/constants";

describe("resolveCapacities", () => {
  it("returns the global defaults when given null/undefined", () => {
    expect(resolveCapacities(null)).toEqual(SLOT_CAPACITIES);
    expect(resolveCapacities(undefined)).toEqual(SLOT_CAPACITIES);
  });

  it("overlays a partial override on top of the defaults", () => {
    const resolved = resolveCapacities({ ELECTRIC_GUITAR: 3, ACOUSTIC_GUITAR: 0 });
    expect(resolved.ELECTRIC_GUITAR).toBe(3); // overridden
    expect(resolved.ACOUSTIC_GUITAR).toBe(0); // "we don't want any"
    expect(resolved.DRUMS).toBe(SLOT_CAPACITIES.DRUMS); // untouched → default
  });

  it("does not mutate the shared SLOT_CAPACITIES default", () => {
    resolveCapacities({ DRUMS: 9 });
    expect(SLOT_CAPACITIES.DRUMS).toBe(1);
  });
});

describe("validateSlotCapacities", () => {
  it("accepts a well-formed role→count map", () => {
    const map = { ELECTRIC_GUITAR: 2, ACOUSTIC_GUITAR: 0 };
    expect(validateSlotCapacities(map)).toEqual(map);
  });

  it("rejects unknown instrument keys", () => {
    expect(validateSlotCapacities({ TRUMPET: 1 })).toBeNull();
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
    expect(validateSlotCapacities({ CHOIR: 2 })).toBeNull();
    expect(validateSlotCapacities({ VOCALS: 2, CHOIR: 1 })).toBeNull();
  });
});

describe("choir role", () => {
  it("is a selectable instrument with a label but not a band/capacity role", () => {
    expect(ALL_INSTRUMENTS).toContain(CHOIR);
    expect(INSTRUMENT_LABELS[CHOIR]).toBe("Choir");
    // Choir has no slot count, so it stays out of the capacity-only lists.
    expect(ROLE_ORDER).not.toContain(CHOIR);
    expect(Object.keys(SLOT_CAPACITIES)).not.toContain(CHOIR);
    expect(resolveCapacities(null)).not.toHaveProperty(CHOIR);
  });

  it("lists every band role plus choir, choir last", () => {
    expect(ALL_INSTRUMENTS).toEqual([...ROLE_ORDER, CHOIR]);
  });
});
