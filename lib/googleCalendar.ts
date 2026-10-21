// Google Calendar integration: every set gets an event on a calendar owned by
// the org's shared church Google account, with the roster invited, and an
// attendee who accepts is confirmed for that set here. Mirrors lib/spotify.ts:
//
//   1. Everything no-ops when the org hasn't connected (no refresh token) —
//      the app runs identically without Google Calendar.
//   2. Nothing throws — a Google outage must never break a roster save or a
//      set delete. Failures are logged and swallowed.
//
// Shape of it:
//   • Connect (OAuth): we make a calendar of our own ("<Org> worship sets")
//     and use it by default. The admin who connected may instead pick one of
//     their account's existing calendars (listCalendarsFor / selectCalendar);
//     that list is shown to THEM only — the routes refuse every other admin,
//     who sees just the chosen calendar's name.
//   • syncSetCalendar(setId) is idempotent: it rebuilds the set's event from
//     the db (lib/calendarEvent.ts) and creates or patches it. Every route that
//     changes a set, its roster or its setlist calls it after responding.
//   • Write-back: a push channel (events.watch) on that calendar pings
//     /api/google-calendar/webhook when anything on it changes; we read the
//     changes with the stored sync token and confirm each PENDING seat whose
//     holder accepted (lib/calendarEvent.ts seatsToConfirm). A No changes
//     nothing. Channels expire (a week at most), so the daily cron renews them
//     and also pulls once, in case a ping was lost.
//
// Server-only (imports prisma).
import crypto from "crypto";
import { after } from "next/server";
import { prisma } from "./prisma";
import { encryptSecret, decryptSecret } from "./crypto";
import { APP_TZ } from "./appTz";
import { setLinkPath } from "./setLink";
import { getTeamCatalog } from "./teamRoleStore";
import { pendingOwners } from "./pendingHandoff";
import {
  SET_ID_PROPERTY,
  attendeesChanged,
  eventAttendees,
  eventDescription,
  eventTimes,
  eventTitle,
  seatsToConfirm,
  type CalendarAttendee,
} from "./calendarEvent";

const ACCOUNTS = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

// `calendar.app.created` = make our own calendar; `calendar.calendarlist.readonly`
// = list the account's calendars for the connecting admin's picker;
// `calendar.events` = put the sets' events on whichever one they pick (and
// watch it). Nothing here reads or changes the calendars themselves.
// `openid email` names the account on the Org settings row.
const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

// Renew a push channel once it's this close to expiring. The cron runs daily,
// so anything under a day would risk a gap; Google caps channels at a week.
const RENEW_WITHIN_MS = 2 * 24 * 60 * 60 * 1000;
const CHANNEL_TTL_SEC = 7 * 24 * 60 * 60;

// Reuses the "Continue with Google" OAuth client (same Google Cloud project),
// which also needs the Calendar API enabled and the callback below registered.
function clientId(): string | undefined {
  return process.env.GOOGLE_CLIENT_ID;
}
function clientSecret(): string | undefined {
  return process.env.GOOGLE_CLIENT_SECRET;
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function redirectUri(): string {
  return process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${baseUrl()}/api/google-calendar/callback`;
}

// Google only pushes to a public HTTPS address, so a local tunnel overrides it.
function webhookUrl(): string {
  return process.env.GOOGLE_CALENDAR_WEBHOOK_URL ?? `${baseUrl()}/api/google-calendar/webhook`;
}

/**
 * Whether this deployment can offer Google Calendar at all: the OAuth client
 * (shared with "Continue with Google") is set. Without it there's no Connect
 * button and every entry point is a no-op. With it, nothing happens until an
 * org admin connects in Org settings.
 */
export function isGoogleCalendarAppConfigured(): boolean {
  return !!clientId() && !!clientSecret();
}

// ── OAuth handshake ────────────────────────────────────────────────────────

// {orgId, userId} round-trips through Google HMAC-signed, like lib/spotify's
// state — but under its own purpose, so one integration's state can't be
// replayed at the other's callback.
type CalState = { p: "gcal"; orgId: string; userId: string; exp: number };

function hmacKey(purpose: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`${purpose}:${process.env.NEXTAUTH_SECRET ?? ""}`)
    .digest();
}

function sign(payload: string, purpose: string): string {
  return crypto.createHmac("sha256", hmacKey(purpose)).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function signState(orgId: string, userId: string, ttlSec = 600): string {
  const body: CalState = { p: "gcal", orgId, userId, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload, "gcal-state")}`;
}

export function verifyState(token: string): { orgId: string; userId: string } | null {
  try {
    const [payload, sig] = token.split(".");
    if (!payload || !sig || !safeEqual(sig, sign(payload, "gcal-state"))) return null;
    const body = JSON.parse(Buffer.from(payload, "base64url").toString()) as CalState;
    if (body.p !== "gcal" || body.exp < Math.floor(Date.now() / 1000)) return null;
    return { orgId: body.orgId, userId: body.userId };
  } catch {
    return null;
  }
}

/** The token Google echoes on every push, so a forged ping is told apart. */
function channelToken(orgId: string): string {
  return sign(orgId, "gcal-channel");
}

export function authorizeUrl(orgId: string, userId: string): string {
  const params = new URLSearchParams({
    client_id: clientId() ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    // consent every time: Google only hands out a refresh token on consent,
    // and select_account lets the admin pick the shared church account.
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: signState(orgId, userId),
  });
  return `${ACCOUNTS}?${params.toString()}`;
}

// ── Tokens + requests ──────────────────────────────────────────────────────

type OrgCal = {
  id: string;
  name: string;
  googleCalRefreshToken: string | null;
  googleCalendarId: string | null;
  googleCalSyncToken: string | null;
  googleCalChannelId: string | null;
  googleCalResourceId: string | null;
  googleCalChannelExpiresAt: Date | null;
};

const ORG_CAL_FIELDS = {
  id: true,
  name: true,
  googleCalRefreshToken: true,
  googleCalendarId: true,
  googleCalSyncToken: true,
  googleCalChannelId: true,
  googleCalResourceId: true,
  googleCalChannelExpiresAt: true,
} as const;

// Access tokens live an hour; one per org is reused until a minute before.
const accessCache = new Map<string, { token: string; until: number }>();

async function accessToken(org: OrgCal): Promise<string | null> {
  const cached = accessCache.get(org.id);
  if (cached && cached.until > Date.now()) return cached.token;
  if (!org.googleCalRefreshToken) return null;
  let refresh: string;
  try {
    refresh = decryptSecret(org.googleCalRefreshToken);
  } catch {
    return null; // key rotated or corrupt — treat as not connected
  }
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId() ?? "",
      client_secret: clientSecret() ?? "",
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    console.error(`[gcal] token refresh failed for org ${org.id}: ${res.status} ${await res.text()}`);
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  accessCache.set(org.id, {
    token: json.access_token,
    until: Date.now() + (json.expires_in - 60) * 1000,
  });
  return json.access_token;
}

type GResult = { ok: boolean; status: number; json: Record<string, unknown> };

async function gapi(
  org: OrgCal,
  method: string,
  path: string,
  body?: unknown
): Promise<GResult | null> {
  const token = await accessToken(org);
  if (!token) return null;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    console.error(`[gcal] ${method} ${path} → ${res.status} ${text.slice(0, 500)}`);
  }
  return { ok: res.ok, status: res.status, json };
}

async function loadOrg(orgId: string): Promise<OrgCal | null> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: ORG_CAL_FIELDS });
  return org?.googleCalRefreshToken && org.googleCalendarId ? org : null;
}

const cal = (org: OrgCal) => `/calendars/${encodeURIComponent(org.googleCalendarId!)}`;

// ── Connect / disconnect ───────────────────────────────────────────────────

/** Swap the callback's code for tokens, make the calendar, start watching it. */
export async function connectOrgFromCode(
  orgId: string,
  code: string,
  // The admin connecting. Only they may later pick another of this account's
  // calendars — the account is theirs (or the church's, in their hands).
  userId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId() ?? "",
        client_secret: clientSecret() ?? "",
        code,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return { ok: false, error: `token exchange ${res.status}: ${await res.text()}` };
    const tokens = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
      id_token?: string;
      scope?: string;
    };
    if (!tokens.refresh_token) return { ok: false, error: "no refresh token in the response" };
    if (!tokens.scope?.includes("calendar.app.created")) {
      return { ok: false, error: "calendar access wasn't granted on the consent screen" };
    }
    const email = emailFromIdToken(tokens.id_token);

    const prior = await prisma.org.findUnique({
      where: { id: orgId },
      select: { ...ORG_CAL_FIELDS, googleCalEmail: true, googleCalendarName: true },
    });
    if (!prior) return { ok: false, error: "org not found" };
    // A reconnect drops the old channel first; it would otherwise keep pinging
    // with a token for a calendar we may be about to stop using.
    await stopChannel(prior).catch(() => {});

    accessCache.set(orgId, {
      token: tokens.access_token,
      until: Date.now() + (tokens.expires_in - 60) * 1000,
    });
    const org: OrgCal = {
      ...prior,
      googleCalRefreshToken: encryptSecret(tokens.refresh_token),
      googleCalChannelId: null,
      googleCalResourceId: null,
      googleCalChannelExpiresAt: null,
      googleCalSyncToken: null,
    };

    // Same account reconnecting keeps its calendar (and every event on it); a
    // different account can't see the old one, so it gets a fresh calendar.
    let calendarId = prior.googleCalEmail === email ? prior.googleCalendarId : null;
    let calendarName = prior.googleCalendarName;
    if (calendarId) {
      const probe = await gapi({ ...org, googleCalendarId: calendarId }, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
      if (!probe?.ok) calendarId = null;
      else if (typeof probe.json.summary === "string") calendarName = probe.json.summary;
    }
    if (!calendarId) {
      const made = await gapi(org, "POST", "/calendars", {
        summary: `${prior.name} worship sets`,
        description: "Created by TapWorship. Every set is an event here, with its roster invited.",
        timeZone: APP_TZ,
      });
      if (!made?.ok || typeof made.json.id !== "string") {
        return { ok: false, error: `couldn't create the calendar (${made?.status ?? "no token"})` };
      }
      calendarId = made.json.id;
      calendarName = typeof made.json.summary === "string" ? made.json.summary : `${prior.name} worship sets`;
      // Events on the old calendar aren't ours to patch any more.
      await prisma.set.updateMany({ where: { orgId }, data: { googleEventId: null } });
    }

    await prisma.org.update({
      where: { id: orgId },
      data: {
        googleCalRefreshToken: org.googleCalRefreshToken,
        googleCalEmail: email,
        googleCalendarId: calendarId,
        googleCalendarName: calendarName,
        googleCalConnectedById: userId,
        googleCalSyncToken: null,
        googleCalChannelId: null,
        googleCalResourceId: null,
        googleCalChannelExpiresAt: null,
      },
    });
    await startWatch({ ...org, googleCalendarId: calendarId });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

/**
 * Forget the connection. The calendar and its events stay in the church
 * account (they're its data); we just stop touching them.
 */
export async function disconnectOrg(orgId: string): Promise<void> {
  const org = await prisma.org.findUnique({ where: { id: orgId }, select: ORG_CAL_FIELDS });
  if (org) await stopChannel(org).catch(() => {});
  accessCache.delete(orgId);
  await prisma.org.update({
    where: { id: orgId },
    data: {
      googleCalRefreshToken: null,
      googleCalEmail: null,
      googleCalConnectedById: null,
      googleCalSyncToken: null,
      googleCalChannelId: null,
      googleCalResourceId: null,
      googleCalChannelExpiresAt: null,
    },
  });
}

// ── Choosing the calendar (the connecting admin only) ──────────────────────

export type CalendarChoice = { id: string; name: string; primary: boolean };

/**
 * The connected account's calendars that events can be written to. The ROUTE
 * decides who may see this (only the admin who connected); this just asks
 * Google. "scope" = connected before the picker existed, or the list box was
 * unticked on the consent screen — reconnecting fixes it.
 */
export async function listCalendarsFor(
  orgId: string
): Promise<CalendarChoice[] | "scope" | null> {
  try {
    const org = await loadOrg(orgId);
    if (!org) return null;
    const res = await gapi(org, "GET", "/users/me/calendarList?minAccessRole=writer&maxResults=250");
    if (!res) return null;
    if (res.status === 403 || res.status === 401) return "scope";
    if (!res.ok) return null;
    type Entry = { id?: string; summary?: string; summaryOverride?: string; primary?: boolean; deleted?: boolean };
    return ((res.json.items as Entry[] | undefined) ?? [])
      .filter((c): c is Entry & { id: string } => typeof c.id === "string" && !c.deleted)
      .map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: !!c.primary }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
  } catch (err) {
    console.error(`[gcal] listing calendars for org ${orgId} failed:`, err);
    return null;
  }
}

/**
 * Move the org's sets onto another of the account's calendars. Each upcoming
 * set's event is cancelled on the old calendar (guests are told) and the
 * caller re-syncs them onto the new one — Google can't move an event's guest
 * list between calendars quietly, and leaving the old ones would double-book
 * everyone. Past sets' events stay where they were.
 */
export async function selectCalendar(
  orgId: string,
  calendarId: string
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const org = await loadOrg(orgId);
  if (!org) return { ok: false, error: "Google Calendar isn't connected." };
  if (org.googleCalendarId === calendarId) return { ok: true, changed: false };
  const choices = await listCalendarsFor(orgId);
  if (choices === "scope") {
    return { ok: false, error: "Reconnect Google Calendar to choose a calendar." };
  }
  const choice = choices?.find((c) => c.id === calendarId);
  if (!choice) return { ok: false, error: "That calendar isn't one you can add events to." };

  await stopChannel(org).catch(() => {});
  const upcoming = await prisma.set.findMany({
    where: { orgId, startsAt: { gte: new Date() }, googleEventId: { not: null } },
    select: { id: true, googleEventId: true },
  });
  for (const s of upcoming) {
    await gapi(org, "DELETE", `${cal(org)}/events/${encodeURIComponent(s.googleEventId!)}?sendUpdates=all`);
  }
  await prisma.set.updateMany({ where: { orgId }, data: { googleEventId: null } });
  await prisma.org.update({
    where: { id: orgId },
    data: {
      googleCalendarId: calendarId,
      googleCalendarName: choice.name,
      googleCalSyncToken: null,
      googleCalChannelId: null,
      googleCalResourceId: null,
      googleCalChannelExpiresAt: null,
    },
  });
  await startWatch({
    ...org,
    googleCalendarId: calendarId,
    googleCalSyncToken: null,
    googleCalChannelId: null,
    googleCalResourceId: null,
  });
  return { ok: true, changed: true };
}

// ── Set ⇄ event ────────────────────────────────────────────────────────────

/**
 * Create or update a set's event so it matches the db. Safe to call after any
 * change, any number of times; a no-op for an unconnected org or a past set.
 */
export async function syncSetCalendar(setId: string): Promise<void> {
  if (!isGoogleCalendarAppConfigured()) return;
  try {
    const set = await prisma.set.findUnique({
      where: { id: setId },
      select: {
        id: true,
        label: true,
        startsAt: true,
        durationMinutes: true,
        orgId: true,
        teamId: true,
        googleEventId: true,
        songs: { select: { title: true, key: true }, orderBy: { order: "asc" } },
        assignments: {
          select: {
            id: true,
            role: true,
            status: true,
            pendingCoverFromUserId: true,
            userId: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!set || set.startsAt.getTime() < Date.now()) return;
    const org = await loadOrg(set.orgId);
    if (!org) return;

    // A seat mid-handoff (a cover or swap awaiting approval) still belongs to
    // the person handing it over, so the invite stays theirs until an admin
    // approves — a rejected handoff then never bounced anyone's invite.
    const owners = await pendingOwners(set.assignments);
    const ownerEmails = new Map(
      (
        await prisma.user.findMany({
          where: { id: { in: [...owners.values()].map((o) => o.id) } },
          select: { id: true, email: true },
        })
      ).map((u) => [u.id, u.email])
    );
    const seats = set.assignments.map((a) => {
      const owner = owners.get(a.id);
      return owner
        ? { role: a.role, userId: owner.id, name: owner.name, email: ownerEmails.get(owner.id) ?? null }
        : { role: a.role, userId: a.userId, name: a.user.name, email: a.user.email };
    });
    const catalog = await getTeamCatalog(set.teamId);
    const description = eventDescription(seats, set.songs, catalog, `${baseUrl()}${setLinkPath(set.id)}`);
    const times = eventTimes(set, APP_TZ);

    if (set.googleEventId) {
      const current = await gapi(org, "GET", `${cal(org)}/events/${encodeURIComponent(set.googleEventId)}`);
      if (current?.ok && current.json.status !== "cancelled") {
        const before = (current.json.attendees as CalendarAttendee[] | undefined) ?? [];
        const attendees = eventAttendees(seats, before);
        const start = (current.json.start as { dateTime?: string } | undefined)?.dateTime;
        const moved = !start || new Date(start).getTime() !== set.startsAt.getTime();
        // Email guests only when it matters to them — someone added or dropped,
        // or the time moved. A setlist edit just updates the event quietly.
        const notify = moved || attendeesChanged(before, attendees) ? "all" : "none";
        await gapi(
          org,
          "PATCH",
          `${cal(org)}/events/${encodeURIComponent(set.googleEventId)}?sendUpdates=${notify}`,
          { summary: eventTitle(set), description, ...times, attendees }
        );
        return;
      }
      if (current === null) return; // no token; try again on the next change
      // Gone (deleted by hand in Google) — fall through and make a new one.
    }

    const made = await gapi(org, "POST", `${cal(org)}/events?sendUpdates=all`, {
      summary: eventTitle(set),
      description,
      ...times,
      attendees: eventAttendees(seats),
      guestsCanModify: false,
      guestsCanInviteOthers: false,
      extendedProperties: { private: { [SET_ID_PROPERTY]: set.id } },
    });
    if (made?.ok && typeof made.json.id === "string") {
      await prisma.set.update({ where: { id: set.id }, data: { googleEventId: made.json.id } });
    }
  } catch (err) {
    console.error(`[gcal] sync of set ${setId} failed:`, err);
  }
}

/** Every upcoming set of an org — the backfill right after connecting. */
export async function syncUpcomingSets(orgId: string): Promise<void> {
  const sets = await prisma.set.findMany({
    where: { orgId, startsAt: { gte: new Date() } },
    select: { id: true },
    orderBy: { startsAt: "asc" },
  });
  for (const s of sets) await syncSetCalendar(s.id);
}

/**
 * Read a set's event id BEFORE deleting the set; hand it to
 * deleteSetCalendarEvent afterwards. Null when there's nothing to delete.
 */
export async function calendarEventOf(
  setId: string
): Promise<{ orgId: string; eventId: string } | null> {
  if (!isGoogleCalendarAppConfigured()) return null;
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { orgId: true, googleEventId: true },
  });
  return set?.googleEventId ? { orgId: set.orgId, eventId: set.googleEventId } : null;
}

/** Cancel a deleted set's event; Google emails the guests the cancellation. */
export async function deleteSetCalendarEvent(
  ref: { orgId: string; eventId: string } | null
): Promise<void> {
  if (!ref || !isGoogleCalendarAppConfigured()) return;
  try {
    const org = await loadOrg(ref.orgId);
    if (!org) return;
    await gapi(org, "DELETE", `${cal(org)}/events/${encodeURIComponent(ref.eventId)}?sendUpdates=all`);
  } catch (err) {
    console.error(`[gcal] delete of event ${ref.eventId} failed:`, err);
  }
}

// ── Write-back ─────────────────────────────────────────────────────────────

async function startWatch(org: OrgCal): Promise<void> {
  const id = crypto.randomUUID();
  const res = await gapi(org, "POST", `${cal(org)}/events/watch`, {
    id,
    type: "web_hook",
    address: webhookUrl(),
    token: channelToken(org.id),
    params: { ttl: String(CHANNEL_TTL_SEC) },
  });
  if (!res?.ok) return; // logged by gapi; the next cron run retries
  await prisma.org.update({
    where: { id: org.id },
    data: {
      googleCalChannelId: id,
      googleCalResourceId: typeof res.json.resourceId === "string" ? res.json.resourceId : null,
      googleCalChannelExpiresAt: res.json.expiration
        ? new Date(Number(res.json.expiration))
        : new Date(Date.now() + CHANNEL_TTL_SEC * 1000),
    },
  });
  // Take a sync token now, so the first ping only reads what changed after it.
  if (!org.googleCalSyncToken) await pullChanges({ ...org, googleCalChannelId: id });
}

async function stopChannel(org: OrgCal): Promise<void> {
  if (!org.googleCalChannelId || !org.googleCalResourceId) return;
  await gapi(org, "POST", "/channels/stop", {
    id: org.googleCalChannelId,
    resourceId: org.googleCalResourceId,
  });
}

/**
 * A push from Google. Only says "something changed on this calendar" — the
 * changes themselves are read with our own credentials, so a forged ping can at
 * most trigger a harmless read; the token check stops even that.
 */
export async function handleNotification(
  channelId: string | null,
  token: string | null,
  resourceState: string | null
): Promise<void> {
  if (!channelId || !isGoogleCalendarAppConfigured()) return;
  const org = await prisma.org.findUnique({
    where: { googleCalChannelId: channelId },
    select: ORG_CAL_FIELDS,
  });
  if (!org?.googleCalRefreshToken || !org.googleCalendarId) return;
  if (!token || !safeEqual(token, channelToken(org.id))) return;
  if (resourceState === "sync") return; // the handshake ping when a channel opens
  await pullChanges(org);
}

/**
 * Read every event changed since the stored sync token and confirm accepted
 * seats. With no token (a channel that just opened, or Google expired the old
 * one with 410) it reads the whole calendar, which also catches up any RSVP
 * made while we weren't listening — applying one twice is a no-op.
 */
async function pullChanges(org: OrgCal): Promise<void> {
  try {
    let syncToken = org.googleCalSyncToken;
    let pageToken: string | undefined;
    for (let page = 0; page < 50; page++) {
      const qs = new URLSearchParams({ maxResults: "250" });
      if (syncToken) qs.set("syncToken", syncToken);
      if (pageToken) qs.set("pageToken", pageToken);
      const res = await gapi(org, "GET", `${cal(org)}/events?${qs.toString()}`);
      if (!res) return;
      if (res.status === 410) {
        syncToken = null; // token expired: start over with a full read
        pageToken = undefined;
        continue;
      }
      if (!res.ok) return;
      for (const ev of (res.json.items as GoogleEvent[] | undefined) ?? []) {
        await applyRsvps(ev);
      }
      if (typeof res.json.nextPageToken === "string") {
        pageToken = res.json.nextPageToken;
        continue;
      }
      if (typeof res.json.nextSyncToken === "string") {
        await prisma.org.update({
          where: { id: org.id },
          data: { googleCalSyncToken: res.json.nextSyncToken },
        });
      }
      return;
    }
  } catch (err) {
    console.error(`[gcal] reading changes for org ${org.id} failed:`, err);
  }
}

type GoogleEvent = {
  status?: string;
  attendees?: CalendarAttendee[];
  extendedProperties?: { private?: Record<string, string> };
};

async function applyRsvps(ev: GoogleEvent): Promise<void> {
  const setId = ev.extendedProperties?.private?.[SET_ID_PROPERTY];
  if (!setId || ev.status === "cancelled" || !ev.attendees?.length) return;
  const seats = await prisma.assignment.findMany({
    where: { setId, status: "PENDING" },
    select: { id: true, role: true, status: true, userId: true, user: { select: { email: true } } },
  });
  const ids = seatsToConfirm(
    ev.attendees,
    seats.map((s) => ({ id: s.id, status: s.status, email: s.user.email }))
  );
  if (ids.length === 0) return;
  const confirmed = seats.filter((s) => ids.includes(s.id));
  await prisma.$transaction([
    prisma.assignment.updateMany({
      where: { id: { in: ids }, status: "PENDING" },
      data: { status: "CONFIRMED", swapReason: null },
    }),
    ...confirmed.map((s) =>
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: s.role,
          actorId: s.userId,
          targetUserId: s.userId,
          type: "CONFIRMED",
          detail: "Accepted the Google Calendar invite",
        },
      })
    ),
  ]);
}

// ── Daily upkeep (cron) ────────────────────────────────────────────────────

/**
 * For every connected org: renew a channel that's about to lapse (or reopen
 * one that never started), then read changes once in case a ping went missing.
 */
export async function maintainCalendarWatches(): Promise<{ renewed: number; orgs: number }> {
  if (!isGoogleCalendarAppConfigured()) return { renewed: 0, orgs: 0 };
  const orgs = await prisma.org.findMany({
    where: { googleCalRefreshToken: { not: null }, googleCalendarId: { not: null } },
    select: ORG_CAL_FIELDS,
  });
  let renewed = 0;
  for (const org of orgs) {
    try {
      const expires = org.googleCalChannelExpiresAt?.getTime() ?? 0;
      if (!org.googleCalChannelId || expires - Date.now() < RENEW_WITHIN_MS) {
        await stopChannel(org).catch(() => {});
        await startWatch(org);
        renewed++;
      }
      if (org.googleCalSyncToken) await pullChanges(org);
    } catch (err) {
      console.error(`[gcal] upkeep for org ${org.id} failed:`, err);
    }
  }
  return { renewed, orgs: orgs.length };
}

/**
 * What the routes call: re-sync these sets' events once the response has gone
 * out, so Google's latency never sits on a save. Duplicates and nulls are fine.
 */
export function syncSetsAfterResponse(...setIds: (string | null | undefined)[]): void {
  if (!isGoogleCalendarAppConfigured()) return;
  const ids = [...new Set(setIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  after(async () => {
    for (const id of ids) await syncSetCalendar(id);
  });
}
