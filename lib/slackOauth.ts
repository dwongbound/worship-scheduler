// Signed state + scopes for the two Slack OAuth flows we drive by hand (rather
// than via NextAuth), because they LINK Slack to an existing session rather
// than logging anyone in:
//   • install (Flow B) — an admin adds the bot to their org's workspace.
//   • connect (Flow A) — a user captures their member id in an org's workspace.
// The `state` round-trips {orgId, userId, purpose} through Slack, HMAC-signed
// with NEXTAUTH_SECRET so a tampered/forged callback is rejected (CSRF guard).
import crypto from "crypto";

export const SLACK_BOT_SCOPES = "chat:write,im:write,mpim:write,users:read.email";
export const SLACK_USER_SCOPES = "openid,email,profile";

export type SlackOAuthState = {
  orgId: string;
  userId: string;
  purpose: "install" | "connect";
};

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required to sign Slack OAuth state");
  return s;
}

function hmac(data: string): string {
  return crypto.createHmac("sha256", secret()).update(data).digest("base64url");
}

/** Sign state for the redirect to Slack. Expires (default 10 min). */
export function signState(data: SlackOAuthState, ttlSec = 600): string {
  const body = { ...data, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const json = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${json}.${hmac(json)}`;
}

/** Verify + parse state from Slack's callback. Returns null if bad or expired. */
export function verifyState(token: string): SlackOAuthState | null {
  const [json, sig] = token.split(".");
  if (!json || !sig) return null;
  const expected = hmac(json);
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const body = JSON.parse(Buffer.from(json, "base64url").toString());
    if (typeof body.exp !== "number" || body.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (body.purpose !== "install" && body.purpose !== "connect") return null;
    return { orgId: body.orgId, userId: body.userId, purpose: body.purpose };
  } catch {
    return null;
  }
}
