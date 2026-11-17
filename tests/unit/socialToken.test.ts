import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { audiencesFor, verifySocialToken } from "@/lib/socialToken";

async function signer() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts: { iss?: string; aud?: string; exp?: number } = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(opts.iss ?? "https://accounts.google.com")
      .setAudience(opts.aud ?? "ios-client")
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
      .sign(privateKey);
  return { keys, sign };
}

describe("verifySocialToken", () => {
  it("reads a good Google token", async () => {
    const { keys, sign } = await signer();
    const token = await sign({ sub: "g1", email: "Sam@Example.com", email_verified: true, name: "Sam R" });
    expect(await verifySocialToken("google", token, ["ios-client"], keys)).toEqual({
      provider: "google",
      subject: "g1",
      email: "sam@example.com",
      name: "Sam R",
    });
  });

  it("reads an Apple token, whose email_verified is a string and which carries no name", async () => {
    const { keys, sign } = await signer();
    const token = await sign(
      { sub: "a1", email: "x@privaterelay.appleid.com", email_verified: "true", name: "ignored" },
      { iss: "https://appleid.apple.com", aud: "com.tapworship.app" }
    );
    expect(await verifySocialToken("apple", token, ["com.tapworship.app"], keys)).toEqual({
      provider: "apple",
      subject: "a1",
      email: "x@privaterelay.appleid.com",
      name: null,
    });
  });

  it("drops an unverified email but keeps the person", async () => {
    const { keys, sign } = await signer();
    const token = await sign({ sub: "g1", email: "a@b.c", email_verified: false });
    expect((await verifySocialToken("google", token, ["ios-client"], keys))?.email).toBeNull();
  });

  it("refuses a token for another app, another issuer, expired, or unsigned by the keys", async () => {
    const { keys, sign } = await signer();
    const other = await signer();
    expect(await verifySocialToken("google", await sign({ sub: "g" }, { aud: "someone-else" }), ["ios-client"], keys)).toBeNull();
    expect(await verifySocialToken("google", await sign({ sub: "g" }, { iss: "https://evil.example" }), ["ios-client"], keys)).toBeNull();
    expect(await verifySocialToken("google", await sign({ sub: "g" }, { exp: Math.floor(Date.now() / 1000) - 600 }), ["ios-client"], keys)).toBeNull();
    expect(await verifySocialToken("google", await other.sign({ sub: "g" }), ["ios-client"], keys)).toBeNull();
    // A Google token presented as Apple's: wrong issuer for that provider.
    expect(await verifySocialToken("apple", await sign({ sub: "g" }, { aud: "ios-client" }), ["ios-client"], keys)).toBeNull();
  });

  it("refuses everything when the provider isn't configured, and garbage always", async () => {
    const { keys, sign } = await signer();
    expect(await verifySocialToken("google", await sign({ sub: "g" }), [], keys)).toBeNull();
    expect(await verifySocialToken("google", "not.a.jwt", ["ios-client"], keys)).toBeNull();
    expect(await verifySocialToken("google", await sign({}), ["ios-client"], keys)).toBeNull();
  });
});

describe("audiencesFor", () => {
  it("reads each provider's own env var, comma-separated", () => {
    const env = { GOOGLE_IOS_CLIENT_ID: "a, b", APPLE_BUNDLE_ID: "com.x.app" };
    expect(audiencesFor("google", env)).toEqual(["a", "b"]);
    expect(audiencesFor("apple", env)).toEqual(["com.x.app"]);
    expect(audiencesFor("apple", {})).toEqual([]);
  });
});
