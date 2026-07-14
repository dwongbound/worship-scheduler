// Unit tests for the platform super-admin allowlist gate (lib/auth isSuperAdmin).
import { afterEach, describe, expect, it } from "vitest";
import { isSuperAdmin } from "@/lib/auth";

afterEach(() => {
  delete process.env.SUPERADMIN_EMAILS;
});

describe("isSuperAdmin", () => {
  it("matches an allowlisted email, case-insensitively and trimmed", () => {
    process.env.SUPERADMIN_EMAILS = " Boss@Example.com , other@x.com";
    expect(isSuperAdmin("boss@example.com")).toBe(true);
    expect(isSuperAdmin("BOSS@EXAMPLE.COM")).toBe(true);
    expect(isSuperAdmin("other@x.com")).toBe(true);
  });

  it("rejects non-listed, null, and undefined emails", () => {
    process.env.SUPERADMIN_EMAILS = "boss@example.com";
    expect(isSuperAdmin("nobody@x.com")).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });

  it("is false when the allowlist is unset", () => {
    expect(isSuperAdmin("anyone@x.com")).toBe(false);
  });
});
