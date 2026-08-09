// Spotify integration: a thin, non-throwing wrapper over the Spotify Web API
// for building a set's collaborative playlist. Mirrors lib/slack.ts's rules:
//
//   1. Everything no-ops when the org hasn't connected Spotify (no refresh
//      token) — the app runs identically without Spotify configured.
//   2. Nothing throws — a Spotify outage must never break a db mutation or the
//      group-chat cron. Failures are logged and reported via a result object.
//
// Auth model: ONE shared church account per org authorizes the app (OAuth
// authorization-code flow). We store its long-lived refresh token encrypted on
// the Org (like slackBotToken) and mint short-lived access tokens on demand.
// Every playlist an org creates lives under that one account, so making it
// `collaborative` lets the whole team edit it from a shared link.
//
// Server-only (imports prisma). The client talks to it via the API routes.
import crypto from "crypto";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./crypto";

const ACCOUNTS = "https://accounts.spotify.com";
const API = "https://api.spotify.com/v1";

// OAuth scopes: create/modify the account's private + public playlists. A
// collaborative playlist must be private (public:false), so we always create
// private ones — but request both scopes to be safe.
const SCOPES = "playlist-modify-private playlist-modify-public";

function clientId(): string | undefined {
  return process.env.SPOTIFY_CLIENT_ID;
}
function clientSecret(): string | undefined {
  return process.env.SPOTIFY_CLIENT_SECRET;
}

// The redirect URI Spotify calls back to after the user authorizes. Must EXACTLY
// match one registered on the Spotify app. Explicit env wins; otherwise derived
// from the app's base URL.
export function redirectUri(): string {
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/spotify/callback`;
}

// Dry-run mode (SPOTIFY_DRY_RUN=1): exercise every code path — song search
// building, playlist logic — but skip the real API calls and stamp a placeholder
// playlist so the flow is testable with zero credentials (dev/test/CI).
function dryRun(): boolean {
  return process.env.SPOTIFY_DRY_RUN === "1" || process.env.SPOTIFY_DRY_RUN === "true";
}

/** Whether the OAuth app itself is configured (client id + secret present). */
export function isSpotifyAppConfigured(): boolean {
  return !!clientId() && !!clientSecret();
}

/**
 * Whether an org can currently build playlists: it has connected a Spotify
 * account, or we're in dry-run mode. Per-org, like isOrgSlackConnected.
 */
export async function isOrgSpotifyConnected(orgId: string): Promise<boolean> {
  if (dryRun()) return true;
  return (await orgRefreshToken(orgId)) !== null;
}

/** The decrypted Spotify refresh token for an org, or null if not connected. */
async function orgRefreshToken(orgId: string): Promise<string | null> {
  const org = await prisma.org.findUnique({
    where: { id: orgId },
    select: { spotifyRefreshToken: true },
  });
  if (!org?.spotifyRefreshToken) return null;
  try {
    return decryptSecret(org.spotifyRefreshToken);
  } catch {
    return null; // key rotated or corrupt — treat as not connected
  }
}

// ── OAuth handshake ────────────────────────────────────────────────────────

// The OAuth `state` round-trips {orgId, userId} through Spotify, HMAC-signed
// with NEXTAUTH_SECRET (like lib/slackOauth) so the callback can't be forged and
// knows which org to store the token under. Short-lived (10 min).
type SpotifyState = { orgId: string; userId: string; exp: number };

function stateKey(): Buffer {
  return crypto.createHash("sha256").update(process.env.NEXTAUTH_SECRET ?? "").digest();
}

export function signState(orgId: string, userId: string, ttlSec = 600): string {
  const body: SpotifyState = { orgId, userId, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyState(token: string): { orgId: string; userId: string } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = crypto.createHmac("sha256", stateKey()).update(payload).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as SpotifyState;
    if (body.exp < Math.floor(Date.now() / 1000)) return null;
    return { orgId: body.orgId, userId: body.userId };
  } catch {
    return null;
  }
}

/**
 * The Spotify authorize URL to send an admin to. `state` is an HMAC-signed
 * {orgId, userId} so the callback knows which org to store the token under and
 * can't be forged (it also re-checks admin against the db).
 */
export function authorizeUrl(orgId: string, userId: string): string {
  const params = new URLSearchParams({
    client_id: clientId() ?? "",
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state: signState(orgId, userId),
    show_dialog: "true", // let them pick which account (the shared one)
  });
  return `${ACCOUNTS}/authorize?${params.toString()}`;
}

// Basic-auth header for the token endpoint (client_id:client_secret, base64).
function basicAuth(): string {
  return Buffer.from(`${clientId()}:${clientSecret()}`).toString("base64");
}

/**
 * Exchange an authorization code for a refresh token and the account's identity,
 * then store them (token encrypted) on the org. Returns ok/err — never throws.
 */
export async function connectOrgFromCode(
  orgId: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSpotifyAppConfigured()) {
    return { ok: false, error: "Spotify isn't configured on the server." };
  }
  try {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.refresh_token) {
      return { ok: false, error: data.error_description ?? "Token exchange failed." };
    }
    // Look up who we just connected as (cosmetic — shown on the admin page).
    let userId: string | null = null;
    let displayName: string | null = null;
    const me = await fetch(`${API}/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    if (me.ok) {
      const profile = await me.json();
      userId = profile.id ?? null;
      displayName = profile.display_name ?? profile.id ?? null;
    }
    await prisma.org.update({
      where: { id: orgId },
      data: {
        spotifyRefreshToken: encryptSecret(data.refresh_token),
        spotifyUserId: userId,
        spotifyDisplayName: displayName,
      },
    });
    return { ok: true };
  } catch (err) {
    console.error("[spotify] connect failed", err);
    return { ok: false, error: "Could not connect Spotify." };
  }
}

/** Disconnect an org's Spotify account (clears the stored token + identity). */
export async function disconnectOrg(orgId: string): Promise<void> {
  await prisma.org.update({
    where: { id: orgId },
    data: {
      spotifyRefreshToken: null,
      spotifyUserId: null,
      spotifyDisplayName: null,
    },
  });
}

// Mint a short-lived access token from an org's refresh token. Null on failure.
async function accessTokenForOrg(orgId: string): Promise<string | null> {
  const refresh = await orgRefreshToken(orgId);
  if (!refresh || !isSpotifyAppConfigured()) return null;
  try {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refresh,
      }),
    });
    const data = await res.json();
    return res.ok ? (data.access_token ?? null) : null;
  } catch (err) {
    console.error("[spotify] token refresh failed", err);
    return null;
  }
}

// The Spotify track URI of the FIRST search result for a title, or null if none.
// (First-result matching is imperfect for worship songs with many versions —
// the WL can always fix the playlist directly since it's collaborative.)
async function searchFirstTrackUri(
  accessToken: string,
  title: string
): Promise<string | null> {
  try {
    const params = new URLSearchParams({ q: title, type: "track", limit: "1" });
    const res = await fetch(`${API}/search?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.tracks?.items?.[0]?.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * Create (or re-sync) the collaborative Spotify playlist for a set, from its
 * SAVED songs. Reuses the set's existing playlist if one was already made (so a
 * re-sync updates it in place, never duplicates). Stores the playlist id + url
 * on the set. Best-effort and non-throwing.
 *
 * Returns the shareable url on success (also persisted as set.spotifyPlaylistUrl
 * so callers — the set modal, the group-chat post — can link to it).
 */
export async function createOrSyncSetPlaylist(
  setId: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: {
      orgId: true,
      label: true,
      startsAt: true,
      spotifyPlaylistId: true,
      spotifyPlaylistUrl: true,
      songs: { orderBy: { order: "asc" }, select: { title: true } },
    },
  });
  if (!set) return { ok: false, error: "Set not found." };
  if (set.songs.length === 0) {
    return { ok: false, error: "This set has no songs yet." };
  }

  const name = playlistName(set.label, set.startsAt);

  // Dry-run: skip every network call but stamp a placeholder so the UI/flow is
  // exercisable without credentials.
  if (dryRun()) {
    const url = set.spotifyPlaylistUrl ?? "https://open.spotify.com/playlist/dry-run";
    console.log(`[spotify:dry-run] would sync "${name}" with:`, set.songs.map((s) => s.title));
    await prisma.set.update({
      where: { id: setId },
      data: { spotifyPlaylistId: set.spotifyPlaylistId ?? "dry-run", spotifyPlaylistUrl: url },
    });
    return { ok: true, url };
  }

  const accessToken = await accessTokenForOrg(set.orgId);
  if (!accessToken) {
    return { ok: false, error: "Spotify isn't connected for this org yet." };
  }

  // Resolve songs → track URIs (drop misses; a missing song just isn't added).
  const uris: string[] = [];
  for (const song of set.songs) {
    const uri = await searchFirstTrackUri(accessToken, song.title);
    if (uri) uris.push(uri);
  }

  // Reuse the set's playlist if it already has one; otherwise create a fresh
  // private + collaborative playlist under the org's connected account.
  let playlistId = set.spotifyPlaylistId;
  let url = set.spotifyPlaylistUrl ?? "";
  if (!playlistId) {
    const org = await prisma.org.findUnique({
      where: { id: set.orgId },
      select: { spotifyUserId: true },
    });
    if (!org?.spotifyUserId) {
      return { ok: false, error: "Spotify account is missing its user id — reconnect it." };
    }
    const created = await spotifyPost(
      accessToken,
      `${API}/users/${org.spotifyUserId}/playlists`,
      {
        name,
        public: false, // required: a collaborative playlist must be private
        collaborative: true, // the whole team can edit it from the link
        description: "Auto-created by Worship Scheduler.",
      }
    );
    if (!created?.id) {
      return { ok: false, error: "Could not create the playlist on Spotify." };
    }
    playlistId = created.id;
    url = created.external_urls?.spotify ?? `https://open.spotify.com/playlist/${playlistId}`;
  }

  // Replace the playlist's tracks with the current setlist (PUT overwrites, so a
  // re-sync mirrors the saved songs exactly). Setlists are small (<50), well
  // under Spotify's 100-uri limit, so no batching is needed.
  const ok = await spotifyPut(accessToken, `${API}/playlists/${playlistId}/tracks`, {
    uris,
  });
  if (!ok) return { ok: false, error: "Could not update the playlist's songs." };

  await prisma.set.update({
    where: { id: setId },
    data: { spotifyPlaylistId: playlistId, spotifyPlaylistUrl: url },
  });
  return { ok: true, url };
}

// A friendly playlist name from the set's label + date, e.g.
// "Sunday Morning — Aug 10".
function playlistName(label: string | null, startsAt: Date): string {
  const date = startsAt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return label ? `${label} — ${date}` : `Worship set — ${date}`;
}

// POST JSON to a Spotify endpoint, returning parsed JSON or null. Never throws.
async function spotifyPost(
  accessToken: string,
  url: string,
  body: unknown
): Promise<{ id?: string; external_urls?: { spotify?: string } } | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// PUT JSON to a Spotify endpoint; returns whether it succeeded. Never throws.
async function spotifyPut(
  accessToken: string,
  url: string,
  body: unknown
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}
