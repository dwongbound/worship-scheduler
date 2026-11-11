// Google and Apple sign-in from the iOS app: checking the ID token the app
// got from the provider, before the server believes a word of it.
//
// The app signs in with Google (an OAuth web session, no SDK) or with Apple
// (AuthenticationServices) and hands the server the provider's signed ID
// token. That token is the only proof of who the person is, so it is checked
// here exactly as the provider documents — signature against its published
// keys, issuer, audience (OUR app, so a token minted for some other app is
// refused), expiry — and only then read.
//
// The key set is a parameter so the unit tests sign tokens with a local key;
// production passes the providers' remote JWKS.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export type SocialProvider = "google" | "apple";

export interface SocialIdentity {
  provider: SocialProvider;
  /** The provider's stable id for this person (`sub`). */
  subject: string;
  /** Lowercased, and only when the provider says it's verified. */
  email: string | null;
  /** Google sends a name; Apple never puts one in the token. */
  name: string | null;
}

const ISSUERS: Record<SocialProvider, string[]> = {
  google: ["https://accounts.google.com", "accounts.google.com"],
  apple: ["https://appleid.apple.com"],
};

const JWKS_URLS: Record<SocialProvider, string> = {
  google: "https://www.googleapis.com/oauth2/v3/certs",
  apple: "https://appleid.apple.com/auth/keys",
};

const remoteKeys = new Map<SocialProvider, JWTVerifyGetKey>();
/** The provider's published keys (cached by jose between requests). */
export function providerKeys(provider: SocialProvider): JWTVerifyGetKey {
  let keys = remoteKeys.get(provider);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(JWKS_URLS[provider]));
    remoteKeys.set(provider, keys);
  }
  return keys;
}

/**
 * Which audiences a provider's token may be addressed to: Google's is the iOS
 * OAuth client id, Apple's the app's bundle id. Empty = that sign-in is not
 * configured, and every token is refused.
 */
export function audiencesFor(
  provider: SocialProvider,
  env: Record<string, string | undefined> = process.env
): string[] {
  const raw = provider === "google" ? env.GOOGLE_IOS_CLIENT_ID : env.APPLE_BUNDLE_ID;
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Truthy the way each provider spells it (Apple sends the string "true"). */
function claimTrue(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * The verified identity, or null for ANY failure — bad signature, wrong app,
 * expired, no subject. A refused token is a failed sign-in, never an error
 * worth explaining to whoever sent it.
 */
export async function verifySocialToken(
  provider: SocialProvider,
  token: string,
  audiences: string[],
  keys: JWTVerifyGetKey = providerKeys(provider)
): Promise<SocialIdentity | null> {
  if (!token || audiences.length === 0) return null;
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ISSUERS[provider],
      audience: audiences,
      algorithms: ["RS256", "ES256"],
      clockTolerance: 60,
    });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    const email =
      typeof payload.email === "string" && claimTrue(payload.email_verified)
        ? payload.email.trim().toLowerCase()
        : null;
    const name =
      provider === "google" && typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim()
        : null;
    return { provider, subject: payload.sub, email, name };
  } catch {
    return null;
  }
}
