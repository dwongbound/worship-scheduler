import { describe, expect, it } from "vitest";
import {
  ACCESS_KEY_PREFIX,
  LAST_USED_RESOLUTION_MS,
  bearerKey,
  generateAccessKey,
  hashAccessKey,
  parseKeyName,
  shouldTouchLastUsed,
} from "@/lib/accessKeys";
import { accessKeyLine, serializeAccessKey } from "@/lib/accessKeyView";

describe("generateAccessKey", () => {
  it("is the prefix and 256 random bits, never the same twice", () => {
    const a = generateAccessKey();
    const b = generateAccessKey();
    expect(a.startsWith("tw_")).toBe(true);
    expect(a.length).toBe(ACCESS_KEY_PREFIX.length + 43);
    expect(a).not.toBe(b);
  });
});

describe("hashAccessKey", () => {
  it("is stable, and is not the key", () => {
    const key = generateAccessKey();
    expect(hashAccessKey(key)).toBe(hashAccessKey(key));
    expect(hashAccessKey(key)).not.toContain(key.slice(3, 12));
    expect(hashAccessKey(key)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("bearerKey", () => {
  const key = generateAccessKey();
  it("reads a key out of a Bearer header", () => {
    expect(bearerKey(`Bearer ${key}`)).toBe(key);
    expect(bearerKey(`bearer   ${key} `)).toBe(key);
  });
  it("refuses anything that isn't one of this app's keys", () => {
    expect(bearerKey(null)).toBeNull();
    expect(bearerKey(key)).toBeNull();
    expect(bearerKey("Bearer vff_someOtherAppsKey12345678901234567890")).toBeNull();
    // The iOS app's session token rides in the same header and is a JWT.
    expect(bearerKey("Bearer eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0.x.y.z")).toBeNull();
    expect(bearerKey("Bearer tw_short")).toBeNull();
    expect(bearerKey(`Basic ${key}`)).toBeNull();
  });
});

describe("parseKeyName", () => {
  it("tidies a name", () => {
    expect(parseKeyName("  Jarvis   on the PC ")).toEqual({ value: "Jarvis on the PC" });
  });
  it("needs one, and a short one", () => {
    expect(parseKeyName("")).toHaveProperty("error");
    expect(parseKeyName(undefined)).toHaveProperty("error");
    expect(parseKeyName("x".repeat(41))).toHaveProperty("error");
  });
});

describe("shouldTouchLastUsed", () => {
  const now = new Date("2026-11-13T20:00:00Z");
  it("writes the first use, then at most every few minutes", () => {
    expect(shouldTouchLastUsed(null, now)).toBe(true);
    expect(shouldTouchLastUsed(new Date(now.getTime() - 60_000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now.getTime() - LAST_USED_RESOLUTION_MS), now)).toBe(true);
  });
});

describe("a key on the wire", () => {
  it("carries no part of the key or its hash", () => {
    const row = {
      id: "k1",
      name: "Jarvis",
      canWrite: false,
      createdAt: new Date(),
      lastUsedAt: null,
      keyHash: "abc",
    };
    expect(Object.keys(serializeAccessKey(row)).sort()).toEqual(
      ["canWrite", "createdAt", "id", "lastUsedAt", "name"].sort()
    );
  });
  it("says what it may do, when it was made and when it was last used", () => {
    const now = new Date("2026-11-13T20:00:00Z");
    const made = now.toISOString();
    expect(accessKeyLine({ canWrite: false, createdAt: made, lastUsedAt: null }, now)).toMatch(
      /^Read-only · made .+ · never used$/
    );
    const used = new Date(now.getTime() - 3 * 3_600_000).toISOString();
    expect(accessKeyLine({ canWrite: true, createdAt: made, lastUsedAt: used }, now)).toMatch(
      /^Can act for you · .+ · last used 3 hours ago$/
    );
  });
});
