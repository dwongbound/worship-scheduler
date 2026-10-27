// Unit tests for lib/schedulingRules `rulesVersion` — the fingerprint that
// keeps two admins from reverting each other.
//
// Scheduling rules are ORG-wide and every save replaces the whole list, so an
// editor holding a ten-minute-old copy would send ten-minute-old copies of
// every rule it ISN'T changing. The fingerprint is how the server notices.
import { describe, expect, it } from "vitest";
import { rulesVersion } from "@/lib/schedulingRules";

describe("rulesVersion", () => {
  it("is the same string for the same list", () => {
    expect(rulesVersion(["a", "b", "c"])).toBe(rulesVersion(["a", "b", "c"]));
  });

  it("changes when the rows change", () => {
    // Every save deletes and re-inserts, so any write at all changes the ids.
    expect(rulesVersion(["a", "b"])).not.toBe(rulesVersion(["a", "b2"]));
    expect(rulesVersion(["a", "b"])).not.toBe(rulesVersion(["a"]));
    expect(rulesVersion(["a", "b"])).not.toBe(rulesVersion(["a", "b", "c"]));
  });

  it("changes when only the ORDER changes", () => {
    // A preference's position IS its rank, so reordering is an edit.
    expect(rulesVersion(["a", "b"])).not.toBe(rulesVersion(["b", "a"]));
  });

  it("has an answer for an empty list", () => {
    expect(rulesVersion([])).toEqual(expect.any(String));
    expect(rulesVersion([])).not.toBe(rulesVersion([""]));
  });

  it("can't be confused by a separator inside an id", () => {
    // Joining on a character ids can contain would make two different lists
    // fingerprint the same, which is exactly the collision that matters here.
    expect(rulesVersion(["a-b"])).not.toBe(rulesVersion(["a", "b"]));
    expect(rulesVersion(["ab"])).not.toBe(rulesVersion(["a", "b"]));
  });

  it("is short enough to put in a request body", () => {
    expect(rulesVersion(["cms490tfq002t0vrsqc81ac3o"]).length).toBeLessThan(10);
  });
});
