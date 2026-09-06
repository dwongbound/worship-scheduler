// Unit tests for the set deep link (lib/setLink.ts) — the one place that knows
// how a link to a set's detail modal is spelled.
import { describe, expect, it } from "vitest";
import { SET_PARAM, setLinkPath } from "@/lib/setLink";

describe("setLinkPath", () => {
  it("points at the calendar with the set in the query", () => {
    expect(setLinkPath("set-123")).toBe("/calendar?set=set-123");
    expect(SET_PARAM).toBe("set");
  });

  it("escapes an id that would otherwise break the query string", () => {
    expect(setLinkPath("a&b=c")).toBe("/calendar?set=a%26b%3Dc");
  });

  it("can point at the set-manager tab instead", () => {
    // Where the take/accept/confirm buttons live — what the cover and swap
    // DMs link to, so the row is ringed and the action is right there.
    expect(setLinkPath("set-123", "set-manager")).toBe(
      "/set-manager?set=set-123"
    );
  });
});
