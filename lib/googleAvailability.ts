// "Import from Google Calendar" on /schedule: a member lets the app read their
// OWN Google Calendars once, and every busy time inside one availability
// request's window becomes a block on it. ALL of their calendars, not just
// `primary` — people keep a work one and a family one, and reading only
// `primary` quietly missed everything on the others. Calendars they merely
// subscribe to are left out; see OWNED_ROLES below. The rules for what counts as busy
// are lib/googleBusy.ts; this is the Google + db side.
//
// The permission is asked for ONCE: the first import goes through Google's
// consent screen, and the refresh token it returns is kept (encrypted) on the
// person's row, so every later import runs server-side with no Google screen
// at all. Sign-in itself never asks for calendar access — that's a scope
// Google must verify, and until it does it would put an "unverified app"
// warning in front of every Google login. A revoked token is forgotten and
// the next import simply asks again.
//
// It shares the org connection's callback (/api/google-calendar/callback,
// told apart by its signed state), so there's no second redirect URI to
// register in Google Cloud.
//
// Server-only (imports prisma).
import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./crypto";
import { targetsUser } from "./availabilityTargets";
import { getMyOrgIds } from "./org";
import { parseLocalDate, toYmd } from "./dates";
import { busyWindows, type GoogleEvent } from "./googleBusy";
import { clientId, clientSecret, redirectUri, signImportState } from "./googleCalendar";

const ACCOUNTS = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const CALENDARS = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const eventsUrl = (calendarId: string) =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;

// Read-only events on the person's calendars. Free/busy alone isn't enough:
// Google marks all-day events Free by default, and those must still block.
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
// ...and the LIST of their calendars, because people keep their commitments
// across several (a work one, a family one) and reading only `primary` missed
// every one of them.
const LIST_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const SCOPES = ["openid", "email", READ_SCOPE, LIST_SCOPE].join(" ");

// A person's own calendars, which is what the import reads. Anything they
// merely SUBSCRIBE to is deliberately left out: holidays, a sports fixture
// feed or someone else's shared calendar are not that person's commitments,
// and a holidays calendar alone would block whole days for everyone.
// accessRole tells the two apart — owner/writer is theirs, reader and
// freeBusyReader are subscriptions.
const OWNED_ROLES = new Set(["owner", "writer"]);
// A ceiling, not an expectation: one request's window is a page per calendar.
const MAX_CALENDARS = 50;

// Only what lib/googleBusy reads — never an event's title or description.
const FIELDS =
  "nextPageToken,items(id,status,transparency,start,end,attendees(self,responseStatus))";
// A month of a busy calendar is a few hundred events; this is a ceiling, not
// an expectation.
const MAX_PAGES = 10;

/** The request, if this person is one it asks (same rule as GET /api/availability). */
export async function importableRequest(userId: string, requestId: string) {
  return prisma.availabilityRequest.findFirst({
    where: {
      id: requestId,
      orgId: { in: await getMyOrgIds(userId) },
      ...targetsUser(userId),
    },
    select: { id: true, startDate: true, endDate: true },
  });
}

export function importAuthorizeUrl(
  userId: string,
  requestId: string,
  email: string | null
): string {
  const params = new URLSearchParams({
    client_id: clientId() ?? "",
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    // Offline + consent: Google only returns a refresh token on a consent
    // screen, and that token is what lets every later import skip this one.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signImportState(userId, requestId),
  });
  // Most people signed in with Google already; this skips the account picker.
  if (email) params.set("login_hint", email);
  return `${ACCOUNTS}?${params.toString()}`;
}

export type ImportResult =
  | { ok: true; blocks: number }
  // needsConsent: there's no usable remembered permission — send them to Google.
  | { ok: false; error: string; needsConsent?: boolean };

interface CalendarListEntry {
  id: string;
  accessRole?: string;
  primary?: boolean;
  deleted?: boolean;
}

/**
 * The calendars this import should read: the person's own, by `accessRole`.
 *
 * `null` means the permission to list them is missing — which is exactly what
 * a token remembered from before this scope existed looks like, so the caller
 * turns it into one more trip through Google's consent screen rather than
 * quietly importing a single calendar again.
 */
async function fetchOwnCalendarIds(token: string): Promise<string[] | null> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      maxResults: "250",
      // Hidden calendars still count: hiding one in Google's sidebar says
      // nothing about whether its events occupy the person.
      showHidden: "true",
      fields: "nextPageToken,items(id,accessRole,primary,deleted)",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${CALENDARS}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) {
      console.error(
        `[gimport] calendar list → ${res.status} ${(await res.text()).slice(0, 500)}`
      );
      return null;
    }
    const json = (await res.json()) as {
      items?: CalendarListEntry[];
      nextPageToken?: string;
    };
    for (const c of json.items ?? []) {
      if (c.deleted) continue;
      if (c.primary || OWNED_ROLES.has(c.accessRole ?? "")) ids.push(c.id);
    }
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return ids.slice(0, MAX_CALENDARS);
}

/** One calendar's events in the window. `null` = that calendar couldn't be read. */
async function fetchCalendarEvents(
  token: string,
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<GoogleEvent[] | null> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      // Recurring events expanded into their occurrences.
      singleEvents: "true",
      maxResults: "2500",
      fields: FIELDS,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await fetch(`${eventsUrl(calendarId)}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(
        `[gimport] events list → ${res.status} ${(await res.text()).slice(0, 500)}`
      );
      return null;
    }
    const json = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    events.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

/**
 * Every own calendar's events in the window, in one list.
 *
 * The same event can sit on two of them (an invitation the person accepted
 * also lands on their own calendar), but `busyWindows` merges overlapping
 * windows per day, so a duplicate costs nothing.
 *
 * One calendar failing does NOT fail the import: the rest still make blocks,
 * and a missing calendar means a few blocks short, not a wrong answer.
 * Failing to list the calendars at all is different — that's `null`.
 */
type FetchedEvents =
  | { ok: true; events: GoogleEvent[] }
  // The calendars couldn't be listed. A token remembered from before the list
  // scope existed looks exactly like this, so the caller re-asks for consent.
  | { ok: false; needsConsent: true }
  | { ok: false; needsConsent: false };

async function fetchEvents(
  token: string,
  timeMin: Date,
  timeMax: Date
): Promise<FetchedEvents> {
  const calendarIds = await fetchOwnCalendarIds(token);
  if (!calendarIds) return { ok: false, needsConsent: true };
  const events: GoogleEvent[] = [];
  let read = 0;
  for (const id of calendarIds) {
    const got = await fetchCalendarEvents(token, id, timeMin, timeMax);
    if (!got) continue;
    read++;
    events.push(...got);
  }
  // Every single calendar refused: report the failure rather than writing an
  // empty import over the blocks the person already had.
  if (read === 0 && calendarIds.length > 0) return { ok: false, needsConsent: false };
  return { ok: true, events };
}

/** Read the request's window with `accessToken` and replace the imported blocks. */
async function runImport(
  userId: string,
  request: { id: string; startDate: Date; endDate: Date },
  accessToken: string
): Promise<ImportResult> {
  // Request dates are server-local midnights (the server runs on APP_TZ),
  // and endDate is the LAST day asked about, so read through the end of it.
  const timeMax = new Date(request.endDate);
  timeMax.setDate(timeMax.getDate() + 1);
  const fetched = await fetchEvents(accessToken, request.startDate, timeMax);
  if (!fetched.ok) {
    return fetched.needsConsent
      ? // The remembered permission predates reading the calendar LIST, so it
        // can only ever see `primary`. One more consent screen fixes that for
        // good, which beats silently importing one calendar out of several.
        { ok: false, error: "needs permission to see your calendars", needsConsent: true }
      : { ok: false, error: "couldn't read the calendars" };
  }

  const windows = busyWindows(
    fetched.events,
    toYmd(request.startDate),
    toYmd(request.endDate)
  );
  await prisma.$transaction([
    prisma.unavailability.deleteMany({
      where: { userId, requestId: request.id, fromGoogle: true },
    }),
    prisma.unavailability.createMany({
      data: windows.map((w) => ({
        userId,
        type: "SPECIFIC" as const,
        startDate: parseLocalDate(w.ymd)!,
        endDate: null,
        startMinute: w.startMinute,
        endMinute: w.endMinute,
        requestId: request.id,
        fromGoogle: true,
      })),
    }),
  ]);
  return { ok: true, blocks: windows.length };
}

/** Has this person granted (and not since revoked) calendar access? */
export async function hasRememberedAccess(userId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleImportRefreshToken: true },
  });
  return !!row?.googleImportRefreshToken;
}

/** Forget the remembered permission (a revoked token, or the person asking). */
export async function forgetAccess(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { googleImportRefreshToken: null },
  });
}

/**
 * The first import: swap the callback's code for tokens, remember the refresh
 * token, then import. Blocks made by hand are never touched.
 */
export async function importFromCode(
  userId: string,
  requestId: string,
  code: string
): Promise<ImportResult> {
  try {
    const request = await importableRequest(userId, requestId);
    if (!request) return { ok: false, error: "request not found for this person" };

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
      refresh_token?: string;
      scope?: string;
    };
    if (!tokens.scope?.includes(READ_SCOPE)) {
      return { ok: false, error: "calendar access wasn't granted on the consent screen" };
    }
    if (tokens.refresh_token) {
      await prisma.user.update({
        where: { id: userId },
        data: { googleImportRefreshToken: encryptSecret(tokens.refresh_token) },
      });
    }
    return await runImport(userId, request, tokens.access_token);
  } catch (err) {
    console.error("[gimport] import failed", err);
    return { ok: false, error: String(err) };
  }
}

/**
 * Every import after the first: no Google screen, just the remembered
 * permission. A refused refresh (revoked in their Google account, or expired)
 * forgets it and answers needsConsent, so the caller sends them to Google.
 */
export async function importWithRememberedAccess(
  userId: string,
  requestId: string
): Promise<ImportResult> {
  try {
    const request = await importableRequest(userId, requestId);
    if (!request) return { ok: false, error: "request not found for this person" };
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { googleImportRefreshToken: true },
    });
    if (!row?.googleImportRefreshToken) return { ok: false, error: "no access", needsConsent: true };
    let refresh: string;
    try {
      refresh = decryptSecret(row.googleImportRefreshToken);
    } catch {
      await forgetAccess(userId);
      return { ok: false, error: "unreadable token", needsConsent: true };
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
      console.error(`[gimport] refresh failed for ${userId}: ${res.status} ${await res.text()}`);
      await forgetAccess(userId);
      return { ok: false, error: "access revoked", needsConsent: true };
    }
    const { access_token } = (await res.json()) as { access_token: string };
    return await runImport(userId, request, access_token);
  } catch (err) {
    console.error("[gimport] import failed", err);
    return { ok: false, error: String(err) };
  }
}
