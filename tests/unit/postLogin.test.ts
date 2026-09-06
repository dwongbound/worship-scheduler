// Unit tests for the post-login redirect guard (lib/postLogin.ts). Only the
// pure half is covered here — the stash needs a browser's sessionStorage.
import { describe, expect, it } from "vitest";
import { DEFAULT_LANDING, safeInternalPath } from "@/lib/postLogin";

describe("safeInternalPath", () => {
  it("keeps an in-app path, query and all", () => {
    expect(safeInternalPath("/calendar?set=abc")).toBe("/calendar?set=abc");
    expect(safeInternalPath("/set-manager?set=abc#cover-1")).toBe(
      "/set-manager?set=abc#cover-1"
    );
  });

  it("refuses anything that would leave this origin", () => {
    // A callbackUrl is just a query param, so these are all reachable by
    // anyone who can get someone to click a link.
    expect(safeInternalPath("https://evil.example/steal")).toBe(DEFAULT_LANDING);
    expect(safeInternalPath("//evil.example")).toBe(DEFAULT_LANDING);
    expect(safeInternalPath("/\\evil.example")).toBe(DEFAULT_LANDING);
    expect(safeInternalPath("javascript:alert(1)")).toBe(DEFAULT_LANDING);
    expect(safeInternalPath("calendar")).toBe(DEFAULT_LANDING);
  });

  it("falls back for nothing at all, and honours a custom fallback", () => {
    expect(safeInternalPath(null)).toBe(DEFAULT_LANDING);
    expect(safeInternalPath("")).toBe(DEFAULT_LANDING);
    expect(safeInternalPath(undefined, "/profile")).toBe("/profile");
  });
});
