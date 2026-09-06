// Where someone was headed before they had to log in.
//
// Following a link to a set while signed out (a Slack DM, a shared address)
// bounces through /login. proxy.ts already appends the original path as
// ?callbackUrl, and the login form sends you there afterwards — but that param
// doesn't survive every route through the door:
//
//   • the Google duplicate-name check bounces back to /login with its OWN
//     params, and the callbackUrl is gone by the time the page reloads;
//   • a brand-new account with no org is sent to /join first, which has no
//     idea what it interrupted.
//
// So the destination is ALSO stashed in sessionStorage for this tab, and read
// back wherever the param can't reach. It expires quickly: a stale stash would
// otherwise hijack an ordinary visit to /login hours later.
//
// `safeInternalPath` is the security half and is pure — a callbackUrl is just a
// query param, so it's attacker-controllable and must never send a browser off
// this origin.

/** sessionStorage key holding the pending destination for this tab. */
export const POST_LOGIN_KEY = "worship:post-login";

/** How long a stashed destination stays interesting. */
export const POST_LOGIN_MAX_AGE_MS = 15 * 60 * 1000;

/** Where you land when nothing said otherwise. */
export const DEFAULT_LANDING = "/calendar";

/**
 * A redirect target we're willing to follow: a path INSIDE this app, and
 * nothing else. Anything absolute (`https://evil.example`), protocol-relative
 * (`//evil.example`, `/\evil.example` — which some browsers treat the same
 * way), or scheme-like (`javascript:…`) falls back instead, so a crafted
 * ?callbackUrl can't turn our login page into an open redirect.
 */
export function safeInternalPath(
  raw: string | null | undefined,
  fallback: string = DEFAULT_LANDING
): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  return raw;
}

/** Remember where this tab was trying to go (no-op if storage is unavailable). */
export function rememberPostLogin(path: string): void {
  try {
    sessionStorage.setItem(
      POST_LOGIN_KEY,
      JSON.stringify({ path, at: Date.now() })
    );
  } catch {
    // Private mode, disabled storage — the ?callbackUrl param still works.
  }
}

/**
 * The stashed destination, or null when there's none, it's stale, or storage
 * isn't readable. Peeking doesn't consume it: the Google round trip reads it
 * more than once before anyone actually lands.
 */
export function peekPostLogin(): string | null {
  try {
    const raw = sessionStorage.getItem(POST_LOGIN_KEY);
    if (!raw) return null;
    const { path, at } = JSON.parse(raw) as { path?: string; at?: number };
    if (typeof path !== "string" || typeof at !== "number") return null;
    if (Date.now() - at > POST_LOGIN_MAX_AGE_MS) {
      clearPostLogin();
      return null;
    }
    return path;
  } catch {
    return null;
  }
}

/** Forget it — called once we've actually sent someone there. */
export function clearPostLogin(): void {
  try {
    sessionStorage.removeItem(POST_LOGIN_KEY);
  } catch {
    // Nothing stored means nothing to clear.
  }
}
