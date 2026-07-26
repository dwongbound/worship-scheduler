import { describe, expect, it } from "vitest";
import { resolveProfileEmail } from "@/lib/profile";

describe("resolveProfileEmail", () => {
  // Password accounts may change their email freely.
  it("lets a password account set a new email", () => {
    expect(resolveProfileEmail(true, "old@x.com", "new@x.com")).toBe("new@x.com");
  });

  it("lets a password account clear its email (empty → null)", () => {
    expect(resolveProfileEmail(true, "old@x.com", "")).toBeNull();
    expect(resolveProfileEmail(true, "old@x.com", undefined)).toBeNull();
    expect(resolveProfileEmail(true, "old@x.com", null)).toBeNull();
  });

  // Google (OAuth-only) accounts can't change their email — the request is
  // ignored and the stored value is kept, even if a new one is submitted.
  it("keeps an OAuth-only account's email regardless of the request", () => {
    expect(resolveProfileEmail(false, "me@gmail.com", "hacker@x.com")).toBe(
      "me@gmail.com"
    );
    expect(resolveProfileEmail(false, "me@gmail.com", "")).toBe("me@gmail.com");
    expect(resolveProfileEmail(false, "me@gmail.com", undefined)).toBe(
      "me@gmail.com"
    );
  });

  it("preserves a null email on an OAuth-only account", () => {
    expect(resolveProfileEmail(false, null, "whatever@x.com")).toBeNull();
  });
});
