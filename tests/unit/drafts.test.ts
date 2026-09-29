// Unit tests for the saved-preview ("draft") rules in lib/drafts.ts.
import { describe, expect, it } from "vitest";
import {
  canSaveDraft,
  draftLabel,
  MAX_DRAFTS,
  normalizeDraftName,
} from "@/lib/drafts";

const kept = (id: string) => ({ id, isRecovery: false });
const recovery = (id: string) => ({ id, isRecovery: true });
const full = Array.from({ length: MAX_DRAFTS }, (_, i) => kept(`k${i}`));

describe("canSaveDraft", () => {
  it("allows a save below the limit", () => {
    expect(canSaveDraft([kept("a")]).ok).toBe(true);
  });

  it("refuses once the keep-slots are full, and says why", () => {
    const result = canSaveDraft(full);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Delete one/);
  });

  it("doesn't count recovery drafts against the limit", () => {
    // The whole point of the separate slot: an admin sitting at five saved
    // plans is exactly who most needs the autosave to keep working.
    expect(canSaveDraft([...full.slice(1), recovery("r")]).ok).toBe(true);
    expect(canSaveDraft([...full, recovery("r")]).ok).toBe(false);
  });

  it("lets a full org re-save a draft it already has", () => {
    // Replacing one in place frees and refills the same slot, so it never needs
    // a spare — otherwise editing a draft would be impossible at the limit.
    expect(canSaveDraft(full, "k2").ok).toBe(true);
  });

  it("still refuses when the id being replaced isn't one of the kept drafts", () => {
    // e.g. re-saving a recovery draft: that's a new keep-slot, not a replacement.
    expect(canSaveDraft(full, "someone-elses-id").ok).toBe(false);
    expect(canSaveDraft([...full, recovery("r")], "r").ok).toBe(false);
  });
});

describe("draftLabel", () => {
  it("uses the name when there is one", () => {
    expect(draftLabel({ name: "Advent", isRecovery: false })).toBe("Advent");
    expect(draftLabel({ name: "  Advent  ", isRecovery: false })).toBe("Advent");
  });

  it("names the unnamed, differently for kept and recovery rows", () => {
    expect(draftLabel({ name: null, isRecovery: false })).toBe("Untitled draft");
    expect(draftLabel({ name: "   ", isRecovery: false })).toBe("Untitled draft");
    expect(draftLabel({ name: null, isRecovery: true })).toBe(
      "Unnamed draft (Autosaved)"
    );
  });
});

describe("normalizeDraftName", () => {
  it("trims, and treats blank as unnamed", () => {
    expect(normalizeDraftName("  Christmas  ")).toBe("Christmas");
    expect(normalizeDraftName("   ")).toBeNull();
    expect(normalizeDraftName("")).toBeNull();
  });

  it("ignores anything that isn't a string", () => {
    expect(normalizeDraftName(undefined)).toBeNull();
    expect(normalizeDraftName(42)).toBeNull();
    expect(normalizeDraftName({ name: "x" })).toBeNull();
  });

  it("caps a very long name rather than rejecting it", () => {
    expect(normalizeDraftName("x".repeat(500))).toHaveLength(80);
  });
});
