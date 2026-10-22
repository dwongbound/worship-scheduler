// "Import from Google Calendar" on /schedule: a member lets the app read their
// OWN Google Calendar once, and every busy time inside one availability
// request's window becomes a block on it. The rules for what counts as busy
// are lib/googleBusy.ts; this is the Google + db side.
//
// Deliberately nothing is kept: no refresh token, no per-person connection.
// The consent hands back a one-hour access token, we read the request's range
// with it there and then, and drop it. Running it again is the same round
// trip — and once someone has granted the permission, Google bounces them
// straight back without a screen (login_hint picks their account).
//
// It shares the org connection's callback (/api/google-calendar/callback,
// told apart by its signed state), so there's no second redirect URI to
// register in Google Cloud.
//
// Server-only (imports prisma).
import { prisma } from "./prisma";
import { targetsUser } from "./availabilityTargets";
import { getMyOrgIds } from "./org";
import { parseLocalDate, toYmd } from "./dates";
import { busyWindows, type GoogleEvent } from "./googleBusy";
import { clientId, clientSecret, redirectUri, signImportState } from "./googleCalendar";

const ACCOUNTS = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Read-only events on the person's calendars. Free/busy alone isn't enough:
// Google marks all-day events Free by default, and those must still block.
const READ_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
const SCOPES = ["openid", "email", READ_SCOPE].join(" ");

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
    // Online: we read once and forget, so there's no refresh token to keep.
    access_type: "online",
    include_granted_scopes: "true",
    state: signImportState(userId, requestId),
  });
  // Most people signed in with Google already; this skips the account picker.
  if (email) params.set("login_hint", email);
  return `${ACCOUNTS}?${params.toString()}`;
}

export type ImportResult = { ok: true; blocks: number } | { ok: false; error: string };

async function fetchEvents(
  token: string,
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
    const res = await fetch(`${EVENTS}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      console.error(`[gimport] events list → ${res.status} ${(await res.text()).slice(0, 500)}`);
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
 * Swap the callback's code for a token, read the person's events across the
 * request's window, and replace their previously imported blocks for that
 * request with the new ones. Blocks they made by hand are never touched.
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
    const tokens = (await res.json()) as { access_token: string; scope?: string };
    if (!tokens.scope?.includes(READ_SCOPE)) {
      return { ok: false, error: "calendar access wasn't granted on the consent screen" };
    }

    // Request dates are server-local midnights (the server runs on APP_TZ),
    // and endDate is the LAST day asked about, so read through the end of it.
    const timeMax = new Date(request.endDate);
    timeMax.setDate(timeMax.getDate() + 1);
    const events = await fetchEvents(tokens.access_token, request.startDate, timeMax);
    if (!events) return { ok: false, error: "couldn't read the calendar" };

    const windows = busyWindows(events, toYmd(request.startDate), toYmd(request.endDate));
    await prisma.$transaction([
      prisma.unavailability.deleteMany({ where: { userId, requestId, fromGoogle: true } }),
      prisma.unavailability.createMany({
        data: windows.map((w) => ({
          userId,
          type: "SPECIFIC" as const,
          startDate: parseLocalDate(w.ymd)!,
          endDate: null,
          startMinute: w.startMinute,
          endMinute: w.endMinute,
          requestId,
          fromGoogle: true,
        })),
      }),
    ]);
    return { ok: true, blocks: windows.length };
  } catch (err) {
    console.error("[gimport] import failed", err);
    return { ok: false, error: String(err) };
  }
}
