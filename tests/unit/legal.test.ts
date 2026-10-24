import { afterEach, describe, expect, it, vi } from "vitest";

// The contact email is read at module load, so each case loads it afresh.
const load = async () => {
  vi.resetModules();
  return import("@/lib/legal");
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;
});

describe("legal pages", () => {
  it("falls back to a contact address when none is configured", async () => {
    const { LEGAL_CONTACT_EMAIL } = await load();
    expect(LEGAL_CONTACT_EMAIL).toBe("privacy@tapworship.com");
  });
  it("takes the configured address, trimmed", async () => {
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = "  hi@example.org \n";
    const { LEGAL_CONTACT_EMAIL } = await load();
    expect(LEGAL_CONTACT_EMAIL).toBe("hi@example.org");
  });
  it("ignores a blank address rather than showing an empty mailto", async () => {
    process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL = "   ";
    const { LEGAL_CONTACT_EMAIL } = await load();
    expect(LEGAL_CONTACT_EMAIL).toBe("privacy@tapworship.com");
  });
  it("lists both pages for the sign-in footer", async () => {
    const { LEGAL_LINKS } = await load();
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/privacy", "/terms"]);
  });
});
