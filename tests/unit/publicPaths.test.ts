import { describe, expect, it } from "vitest";
import { HOME_PATH, isChromelessPath, isPublicPath } from "@/lib/publicPaths";
import { LEGAL_LINKS } from "@/lib/legal";

describe("isPublicPath", () => {
  it("lets a stranger read the home page", () => {
    // The whole point of the page: Google's OAuth review fetches "/" with no
    // account, and a bounce to /login here is the finding that failed review.
    expect(isPublicPath(HOME_PATH)).toBe(true);
  });

  it("lets a stranger read the sign-in screen and its sub-paths", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/login/reset")).toBe(true);
  });

  it("lets a stranger read both legal pages", () => {
    for (const link of LEGAL_LINKS) expect(isPublicPath(link.href)).toBe(true);
  });

  it("keeps the app itself behind the login", () => {
    for (const path of ["/calendar", "/create", "/profile", "/join", "/set-manager"]) {
      expect(isPublicPath(path)).toBe(false);
    }
  });

  it("doesn't let a path merely STARTING with a public one through", () => {
    // "/privacy-report" is not the privacy policy, and "/joinery" is not /join.
    expect(isPublicPath("/privacy-report")).toBe(false);
    expect(isPublicPath("/terms-of-the-deal")).toBe(false);
  });
});

describe("isChromelessPath", () => {
  it("covers every public page", () => {
    expect(isChromelessPath(HOME_PATH)).toBe(true);
    expect(isChromelessPath("/login")).toBe(true);
    for (const link of LEGAL_LINKS) expect(isChromelessPath(link.href)).toBe(true);
  });

  it("also covers /join, which is signed in but has no org to navigate", () => {
    expect(isChromelessPath("/join")).toBe(true);
    expect(isPublicPath("/join")).toBe(false);
  });

  it("leaves the app's own pages with their chrome", () => {
    for (const path of ["/calendar", "/create", "/profile"]) {
      expect(isChromelessPath(path)).toBe(false);
    }
  });
});
