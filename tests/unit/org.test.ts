// Unit tests for ORG_KEYS parsing (lib/orgKeys.ts) — the env format that
// defines organizations and their join keys ("Name:key,Name:key").
import { describe, expect, it, vi } from "vitest";
import { parseOrgKeys } from "@/lib/orgKeys";

// The malformed/duplicate branches warn on purpose; keep test output clean.
vi.spyOn(console, "warn").mockImplementation(() => {});

describe("parseOrgKeys", () => {
  it("parses comma-separated Name:key entries, trimming whitespace", () => {
    expect(parseOrgKeys("Sunday Church:key123, Youth Ministry : key456 ")).toEqual([
      { name: "Sunday Church", key: "key123" },
      { name: "Youth Ministry", key: "key456" },
    ]);
  });

  it("splits on the LAST colon so names may contain colons", () => {
    expect(parseOrgKeys("Church: North Campus:key1")).toEqual([
      { name: "Church: North Campus", key: "key1" },
    ]);
  });

  it("drops malformed entries (no colon, empty name or key)", () => {
    expect(parseOrgKeys("no-colon,:key-only,name-only:,Good:key")).toEqual([
      { name: "Good", key: "key" },
    ]);
  });

  it("drops duplicate names and duplicate keys after the first", () => {
    expect(
      parseOrgKeys("A:key1,A:key2,B:key1,B:key3")
    ).toEqual([
      { name: "A", key: "key1" },
      { name: "B", key: "key3" },
    ]);
  });

  it("never accepts the migration placeholder name", () => {
    expect(parseOrgKeys("__default__:key1")).toEqual([]);
  });

  it("returns [] for empty input", () => {
    expect(parseOrgKeys("")).toEqual([]);
    expect(parseOrgKeys("  ,  ")).toEqual([]);
  });

  it("defaults to process.env.ORG_KEYS when called with no argument", () => {
    const original = process.env.ORG_KEYS;
    try {
      process.env.ORG_KEYS = "Env Org:env-key";
      expect(parseOrgKeys()).toEqual([{ name: "Env Org", key: "env-key" }]);
      delete process.env.ORG_KEYS;
      expect(parseOrgKeys()).toEqual([]);
    } finally {
      process.env.ORG_KEYS = original;
    }
  });
});
