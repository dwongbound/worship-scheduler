import { describe, expect, it } from "vitest";
import { signInMethod } from "@/lib/signInMethod";

describe("signInMethod", () => {
  const base = { appleSub: null, googleSignInAt: null, passwordHash: "hash" };

  it("a username + password account has none", () => {
    expect(signInMethod(base)).toBeNull();
  });
  it("an account that also signs in with Google says Google", () => {
    expect(signInMethod({ ...base, googleSignInAt: new Date() })).toBe("google");
  });
  it("an account with no password was made by Google", () => {
    expect(signInMethod({ ...base, passwordHash: "" })).toBe("google");
  });
  it("Apple wins when it's linked", () => {
    expect(signInMethod({ ...base, appleSub: "000123.abc", googleSignInAt: new Date() })).toBe("apple");
  });
});
