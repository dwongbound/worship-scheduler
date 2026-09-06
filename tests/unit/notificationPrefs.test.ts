// Unit tests for the per-org notification switches (lib/notificationPrefs.ts).
import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_TYPES,
  mergeNotificationPrefs,
  notificationEnabled,
  parseNotificationPrefs,
  validateNotificationPrefs,
} from "@/lib/notificationPrefs";

describe("the catalog", () => {
  it("has unique keys and a label + description for each", () => {
    const keys = NOTIFICATION_TYPES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of NOTIFICATION_TYPES) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    }
  });
});

describe("notificationEnabled", () => {
  it("treats anything unrecorded as ON", () => {
    // A null column (every org that predates the setting), an empty map, and a
    // map that simply doesn't mention this type all mean "still sent".
    expect(notificationEnabled(null, "COVER_REQUESTED")).toBe(true);
    expect(notificationEnabled(undefined, "COVER_REQUESTED")).toBe(true);
    expect(notificationEnabled({}, "COVER_REQUESTED")).toBe(true);
    expect(notificationEnabled({ DAILY_DIGEST: false }, "COVER_REQUESTED")).toBe(
      true
    );
  });

  it("is off only for a type explicitly switched off", () => {
    expect(notificationEnabled({ DAILY_DIGEST: false }, "DAILY_DIGEST")).toBe(false);
    expect(notificationEnabled({ DAILY_DIGEST: true }, "DAILY_DIGEST")).toBe(true);
  });
});

describe("parseNotificationPrefs", () => {
  it("keeps known boolean entries and drops everything else", () => {
    expect(
      parseNotificationPrefs({
        COVER_TAKEN: false,
        NOT_A_TYPE: false, // unknown key
        SWAP_PROPOSED: "false", // not a boolean
      })
    ).toEqual({ COVER_TAKEN: false });
  });

  it("reads a null/garbage column as an empty map (= everything on)", () => {
    expect(parseNotificationPrefs(null)).toEqual({});
    expect(parseNotificationPrefs("nope")).toEqual({});
    expect(parseNotificationPrefs([1, 2])).toEqual({});
  });
});

describe("validateNotificationPrefs", () => {
  it("accepts a partial map of known switches", () => {
    expect(validateNotificationPrefs({ SWAP_RESOLVED: false })).toEqual({
      SWAP_RESOLVED: false,
    });
    expect(validateNotificationPrefs({})).toEqual({});
  });

  it("rejects an unknown key, a non-boolean, or a non-object", () => {
    // A typo'd key would otherwise store a toggle nothing ever reads.
    expect(validateNotificationPrefs({ COVER_REQUESTD: false })).toBeNull();
    expect(validateNotificationPrefs({ COVER_REQUESTED: "off" })).toBeNull();
    expect(validateNotificationPrefs(null)).toBeNull();
    expect(validateNotificationPrefs([])).toBeNull();
  });
});

describe("mergeNotificationPrefs", () => {
  it("writes the new decisions over the stored ones, keeping the rest", () => {
    expect(
      mergeNotificationPrefs(
        { COVER_TAKEN: false, DAILY_DIGEST: false },
        { DAILY_DIGEST: true }
      )
    ).toEqual({ COVER_TAKEN: false, DAILY_DIGEST: true });
  });
});
