// Unit tests for MD eligibility + default pick (lib/md.ts).
import { describe, expect, it } from "vitest";
import { defaultMDId, eligibleMDIds, isValidMD, type MDAssignment } from "@/lib/md";

// Shorthand for a roster row.
const a = (userId: string, role: MDAssignment["role"], isMD = false): MDAssignment => ({
  userId,
  role,
  isMD,
});

describe("eligibleMDIds", () => {
  it("includes MDs playing an MD-capable role (keys/electric/bass)", () => {
    const roster = [a("k", "KEYS", true), a("e", "ELECTRIC_GUITAR", true), a("b", "BASS", true)];
    expect(new Set(eligibleMDIds(roster))).toEqual(new Set(["k", "e", "b"]));
  });

  it("excludes non-MDs and MDs in non-MD-capable roles", () => {
    const roster = [a("k", "KEYS", false), a("d", "DRUMS", true), a("v", "VOCALS", true)];
    expect(eligibleMDIds(roster)).toEqual([]);
  });

  it("excludes the worship leader even when they also play an MD role", () => {
    // Same person on WL and Keys → the WL slot bars them from being MD.
    const roster = [a("p", "WORSHIP_LEADER", true), a("p", "KEYS", true)];
    expect(eligibleMDIds(roster)).toEqual([]);
  });

  it("returns distinct ids in scarce-first role order", () => {
    // ROLE_ORDER puts BASS before KEYS before ELECTRIC_GUITAR.
    const roster = [
      a("e", "ELECTRIC_GUITAR", true),
      a("k", "KEYS", true),
      a("b", "BASS", true),
    ];
    expect(eligibleMDIds(roster)).toEqual(["b", "k", "e"]);
  });
});

describe("defaultMDId", () => {
  it("picks the first eligible person (scarce-first)", () => {
    const roster = [a("k", "KEYS", true), a("b", "BASS", true)];
    expect(defaultMDId(roster)).toBe("b"); // bass outranks keys
  });

  it("is null when nobody qualifies", () => {
    expect(defaultMDId([a("d", "DRUMS", true)])).toBeNull();
  });
});

describe("isValidMD", () => {
  const roster = [a("k", "KEYS", true), a("d", "DRUMS", false)];

  it("is true for an eligible assignee", () => {
    expect(isValidMD("k", roster)).toBe(true);
  });

  it("is false for an ineligible or unknown id, and for null", () => {
    expect(isValidMD("d", roster)).toBe(false);
    expect(isValidMD("nope", roster)).toBe(false);
    expect(isValidMD(null, roster)).toBe(false);
  });
});
