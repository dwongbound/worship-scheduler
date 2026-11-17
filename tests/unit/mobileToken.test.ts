import { describe, expect, it } from "vitest";
import { encode } from "next-auth/jwt";
import {
  mintMobileToken,
  parseBearer,
  readMobileToken,
} from "@/lib/mobileToken";

const SECRET = "test-secret-for-mobile-tokens";
const USER = {
  id: "u1",
  name: "Paul",
  email: "paul@example.com",
  memberships: [{ orgId: "o1", isAdmin: true }],
};

describe("parseBearer", () => {
  it("reads a Bearer token, case-insensitively", () => {
    expect(parseBearer("Bearer abc.def")).toBe("abc.def");
    expect(parseBearer("bearer abc")).toBe("abc");
    expect(parseBearer("  BEARER   abc  ")).toBe("abc");
  });
  it("treats anything else as no token", () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer ")).toBeNull();
    expect(parseBearer("Basic dXNlcjpwYXNz")).toBeNull();
    expect(parseBearer("abc.def")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
  });
});

describe("mintMobileToken / readMobileToken", () => {
  it("round-trips the user", async () => {
    const token = await mintMobileToken(USER, SECRET);
    expect(await readMobileToken(token, SECRET)).toEqual(USER);
  });
  it("refuses a token made with another secret", async () => {
    const token = await mintMobileToken(USER, "some-other-secret");
    expect(await readMobileToken(token, SECRET)).toBeNull();
  });
  it("refuses garbage, a missing token and a missing secret", async () => {
    expect(await readMobileToken("not-a-jwt", SECRET)).toBeNull();
    expect(await readMobileToken(null, SECRET)).toBeNull();
    const token = await mintMobileToken(USER, SECRET);
    expect(await readMobileToken(token, undefined)).toBeNull();
  });
  it("refuses an expired token", async () => {
    // NextAuth's decode allows 15s of clock skew, so expire well past that.
    const token = await mintMobileToken(USER, SECRET, -60);
    expect(await readMobileToken(token, SECRET)).toBeNull();
  });
  it("refuses a valid token that names no user", async () => {
    const token = await encode({ token: { name: "x" }, secret: SECRET });
    expect(await readMobileToken(token, SECRET)).toBeNull();
  });
  it("reads a web session's token too — it is the same format", async () => {
    const token = await encode({
      token: { id: "u2", sub: "u2", email: "a@b.c" },
      secret: SECRET,
    });
    expect(await readMobileToken(token, SECRET)).toEqual({
      id: "u2",
      name: null,
      email: "a@b.c",
      memberships: [],
    });
  });
});
