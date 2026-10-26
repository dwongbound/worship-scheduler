// Google Calendar sync — the PURE half: what a set's event says, who it
// invites, and which seats an attendee's RSVP confirms. No prisma, no fetch, so
// it's unit-tested (tests/unit/calendarEvent.test.ts); lib/googleCalendar.ts is
// the side that talks to Google and the db.
//
// One event per set, owned by the org's connected church account and invited
// to everyone holding a seat on it. The description carries what the set's
// Slack messages carry — the roster by role, the setlist, a link back — in
// plain text, because Google renders a description as text (a few tags at
// most) and every other calendar client shows it raw.
import { orderedRoles, roleLabel, type TeamRoleDef } from "./teamRoles";

/** The set fields the event is built from. */
export interface CalendarSet {
  id: string;
  label: string | null;
  startsAt: Date;
  durationMinutes: number;
  notes?: string | null;
}

/** One seat on the set: who holds which role. */
export interface CalendarSeat {
  role: string;
  userId: string;
  name: string;
  email: string | null;
  // Whether this person wants their sets as calendar invites (User
  // .calendarInvites, on by default). False keeps them OFF THE GUEST LIST
  // only: the seat is still theirs and their name is still in the event's
  // roster, so the team sees who is playing.
  calendarInvites?: boolean;
}

export interface CalendarSong {
  title: string;
  key: string | null;
}

/** The subset of a Google event attendee this app reads and writes. */
export interface CalendarAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
}

/** The private extended property every app-made event carries. */
export const SET_ID_PROPERTY = "tapworshipSetId";

export function eventTitle(set: Pick<CalendarSet, "label">): string {
  return set.label?.trim() || "Worship set";
}

/** Lower-cased and trimmed: Google compares attendee emails case-insensitively. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * The description: roster in the team's role order (a person in two roles
 * appears under both), then the setlist when there is one, then the link.
 */
export function eventDescription(
  seats: CalendarSeat[],
  songs: CalendarSong[],
  catalog: TeamRoleDef[],
  link: string
): string {
  const order = new Map(orderedRoles(catalog).map((r, i) => [r.key, i]));
  const rank = (key: string) => order.get(key) ?? Number.MAX_SAFE_INTEGER;
  const byRole = new Map<string, string[]>();
  for (const s of [...seats].sort(
    (a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role)
  )) {
    const names = byRole.get(s.role) ?? [];
    names.push(s.name);
    byRole.set(s.role, names);
  }

  const lines: string[] = ["Roster"];
  if (byRole.size === 0) lines.push("Nobody scheduled yet");
  for (const [role, names] of byRole) {
    lines.push(`${roleLabel(role, catalog)}: ${names.join(", ")}`);
  }
  if (songs.length > 0) {
    lines.push("", "Setlist");
    songs.forEach((song, i) => {
      lines.push(`${i + 1}. ${song.title}${song.key ? ` (${song.key})` : ""}`);
    });
  }
  lines.push("", `Open this set in TapWorship: ${link}`);
  return lines.join("\n");
}

/**
 * The attendee list for a set: one row per person with an email, however many
 * roles they hold, keeping the RSVP Google already has for anyone staying on —
 * sending an attendee without it resets their answer to "needs action".
 *
 * Anyone who has switched invites off is left out, which is also how they get
 * dropped from an event they were already on: the next sync sends a guest list
 * without them, and Google uninvites them. The opt-out is read as FALSE only —
 * an undefined flag (a caller that doesn't track it) still gets invited, since
 * being invited is the default.
 */
export function eventAttendees(
  seats: CalendarSeat[],
  existing: CalendarAttendee[] = []
): CalendarAttendee[] {
  const previous = new Map(
    existing.flatMap((a) => {
      const e = normalizeEmail(a.email);
      return e ? [[e, a] as const] : [];
    })
  );
  const seen = new Set<string>();
  const out: CalendarAttendee[] = [];
  for (const s of seats) {
    if (s.calendarInvites === false) continue;
    const email = normalizeEmail(s.email);
    if (!email || seen.has(email)) continue;
    seen.add(email);
    const prior = previous.get(email);
    out.push({
      email,
      displayName: s.name,
      ...(prior?.responseStatus ? { responseStatus: prior.responseStatus } : {}),
    });
  }
  return out;
}

/** Did the guest list change? Drives whether Google emails everyone. */
export function attendeesChanged(
  before: CalendarAttendee[],
  after: CalendarAttendee[]
): boolean {
  const a = new Set(before.flatMap((x) => normalizeEmail(x.email) ?? []));
  const b = new Set(after.flatMap((x) => normalizeEmail(x.email) ?? []));
  if (a.size !== b.size) return true;
  for (const e of a) if (!b.has(e)) return true;
  return false;
}

/** The event's start/end in the app's zone, as Google's EventDateTime. */
export function eventTimes(set: Pick<CalendarSet, "startsAt" | "durationMinutes">, timeZone: string) {
  const end = new Date(set.startsAt.getTime() + set.durationMinutes * 60_000);
  return {
    start: { dateTime: set.startsAt.toISOString(), timeZone },
    end: { dateTime: end.toISOString(), timeZone },
  };
}

/**
 * Which seats an RSVP confirms. Only an "accepted" answer counts — a decline
 * or a maybe changes nothing in the app (the person still owns their seat and
 * can request cover there) — and only a PENDING seat moves: a seat out for
 * cover or a swap stays as it is.
 *
 * Someone who has switched invites off is skipped even if Google still reports
 * an accepted answer for them: the change that removes them from the guest
 * list and the notification carrying their old RSVP can cross, and an invite
 * they asked not to have shouldn't be confirming seats on their behalf.
 */
export function seatsToConfirm(
  attendees: CalendarAttendee[],
  seats: {
    id: string;
    status: string;
    email: string | null;
    calendarInvites?: boolean;
  }[]
): string[] {
  const accepted = new Set(
    attendees
      .filter((a) => a.responseStatus === "accepted")
      .flatMap((a) => normalizeEmail(a.email) ?? [])
  );
  return seats
    .filter((s) => s.status === "PENDING")
    .filter((s) => s.calendarInvites !== false)
    .filter((s) => {
      const e = normalizeEmail(s.email);
      return e !== null && accepted.has(e);
    })
    .map((s) => s.id);
}
