// Signing in from the iOS app.
//
// The web app's session is a NextAuth JWT in a cookie. A native client has no
// cookie jar worth relying on, so it carries the SAME token in an
// `Authorization: Bearer …` header instead. Deliberately the same token, not a
// new kind: it is minted with NextAuth's own `encode`, the same secret and the
// same claims the jwt callback writes (`id`, `name`, `email`, `memberships`),
// so there is one credential format, one secret to rotate, and no token table
// to keep. `getSessionUser` (lib/auth.ts) reads a cookie first and falls back to
// this header, which is what lets every existing route serve the app unchanged.
//
// What it inherits from the web session, on purpose: it lasts as long as a web
// session (`MOBILE_TOKEN_MAX_AGE_S`), it is refused once its user row is gone,
// and the memberships it carries are hints only — every route re-checks the db.
//
// Pure apart from next-auth/jwt itself; the secret is passed in, so the unit
// tests run without env.
import { decode, encode, type JWT } from "next-auth/jwt";
import type { SessionOrgMembership } from "@/types/next-auth";

/** The same lifetime NextAuth gives a web session (its built-in default). */
export const MOBILE_TOKEN_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface MobileTokenUser {
  id: string;
  name: string | null;
  email: string | null;
  memberships: SessionOrgMembership[];
}

/**
 * The token out of an `Authorization` header, or null. Only the `Bearer`
 * scheme, case-insensitively as RFC 6750 allows; anything else — Basic, an
 * empty token, a bare value with no scheme — is "no token", never an error,
 * because a request without one is simply a signed-out request.
 */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Mint the token the app keeps in its Keychain. */
export async function mintMobileToken(
  user: MobileTokenUser,
  secret: string,
  maxAge = MOBILE_TOKEN_MAX_AGE_S
): Promise<string> {
  const token: JWT = {
    id: user.id,
    sub: user.id,
    name: user.name,
    email: user.email,
    memberships: user.memberships,
  };
  return encode({ token, secret, maxAge });
}

/**
 * The user a token names, or null when it is missing, forged, expired or
 * carries no id. `decode` throws on a token it can't decrypt; that is a
 * signed-out request too, so it is caught here rather than in every caller.
 */
export async function readMobileToken(
  raw: string | null,
  secret: string | undefined
): Promise<MobileTokenUser | null> {
  if (!raw || !secret) return null;
  let token: JWT | null;
  try {
    token = await decode({ token: raw, secret });
  } catch {
    return null;
  }
  if (!token || typeof token.id !== "string" || !token.id) return null;
  return {
    id: token.id,
    name: typeof token.name === "string" ? token.name : null,
    email: typeof token.email === "string" ? token.email : null,
    memberships: Array.isArray(token.memberships) ? token.memberships : [],
  };
}
