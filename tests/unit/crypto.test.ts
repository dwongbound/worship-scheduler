// Unit tests for the at-rest secret encryption (lib/crypto), used for per-org
// Slack bot tokens. Key is derived from NEXTAUTH_SECRET.
import { beforeEach, describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-key";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value and never stores it in the clear", () => {
    const blob = encryptSecret("xoxb-super-secret");
    expect(blob).not.toContain("xoxb-super-secret");
    expect(decryptSecret(blob)).toBe("xoxb-super-secret");
  });

  it("uses a random IV, so the same plaintext encrypts differently each time", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("fails to decrypt once the key (NEXTAUTH_SECRET) changes", () => {
    const blob = encryptSecret("secret");
    process.env.NEXTAUTH_SECRET = "a-different-secret";
    expect(() => decryptSecret(blob)).toThrow();
  });

  it("throws on malformed ciphertext", () => {
    expect(() => decryptSecret("not-a-valid-blob")).toThrow();
  });
});
