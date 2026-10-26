import { afterEach, describe, expect, it, vi } from "vitest";

// The contact email is read at module load, so each case loads it afresh.
const load = async () => {
  vi.resetModules();
  return import("@/lib/legal");
};

afterEach(() => {
  delete process.env.NEXT_PUBLIC_LEGAL_CONTACT_EMAIL;
  delete process.env.NEXT_PUBLIC_CONTACT_EMAIL;
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
  it("keeps the home page's contact address separate from the policy one", async () => {
    // The home page asks people to write and get set up; /privacy and /terms
    // name where deletion requests go. Same default deployment, different
    // mailbox — one of them is quoted in a legal document.
    const { CONTACT_EMAIL, LEGAL_CONTACT_EMAIL } = await load();
    expect(CONTACT_EMAIL).toBe("dswong2001@gmail.com");
    expect(CONTACT_EMAIL).not.toBe(LEGAL_CONTACT_EMAIL);
  });
  it("takes a configured contact address, trimmed, and ignores a blank one", async () => {
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = " hello@example.org ";
    expect((await load()).CONTACT_EMAIL).toBe("hello@example.org");
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = "  ";
    expect((await load()).CONTACT_EMAIL).toBe("dswong2001@gmail.com");
  });
  it("lists both pages for the sign-in footer", async () => {
    const { LEGAL_LINKS } = await load();
    expect(LEGAL_LINKS.map((l) => l.href)).toEqual(["/privacy", "/terms"]);
  });
});
