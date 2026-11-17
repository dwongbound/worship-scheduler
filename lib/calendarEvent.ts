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
  // Whether Google EMAILS them about it (User.calendarInviteEmails, on by
  // default). They are still a guest either way — this only decides whether
  // the invite arrives silently. Read as FALSE only, like the flag above: a
  // caller that doesn't track it gets the emails, since that is the default.
  calendarInviteEmails?: boolean;
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

/**
 * A practice's event carries its own id as well as its set's, so a webhook can
 * tell "the Sunday service" from "the Wednesday rehearsal for it" without
 * guessing from the title.
 */
export const PRACTICE_ID_PROPERTY = "tapworshipPracticeId";

export function eventTitle(set: Pick<CalendarSet, "label">): string {
  return set.label?.trim() || "Worship set";
}

/**
 * A practice's event title. Named after its set, because that is the only
 * thing that tells two of them apart in a month of calendar entries — and
 * prefixed, so the rehearsal never reads as the service itself.
 *
 * The prefix is bracketed rather than "Practice: …" so the set's own name
 * starts as early as possible: a calendar cell truncates hard, and a colon
 * prefix spends its first characters on a word every practice shares.
 */
export function practiceTitle(set: Pick<CalendarSet, "label">): string {
  return `(Practice) ${eventTitle(set)}`;
}

/** Lower-cased and trimmed: Google compares attendee emails case-insensitively. */
export function normalizeEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/**
 * The address a person's set invites go to.
 *
 * Google puts an invite on the default calendar of whatever account it was
 * addressed to, and an attendee can't move an invited event afterwards — so
 * the only way to choose where these land is to choose the address. A Google
 * calendar has an address of its own, so someone who wants their sets on a
 * separate, colour-coded calendar points `calendarInviteEmail` at it. The
 * RSVP then comes back from that same address, which is why `seatsToConfirm`
 * matches on this reading too and not on the account email.
 */
export function inviteAddress(
  user: { email: string | null; calendarInviteEmail?: string | null }
): string | null {
  return normalizeEmail(user.calendarInviteEmail) ?? normalizeEmail(user.email);
}

/**
 * The description: roster in the team's role order (a person in two roles
 * appears under both), then the setlist when there is one, then the link.
 *
 * The set's MD is marked "(MD)" after their name, the same mark the Slack
 * roster and the weekly summary use — matched by id, so a set with no MD
 * marks nobody. A seat mid-handoff is listed in its old owner's name, which
 * is also who can still be the set's MD until an admin approves.
 */
export function eventDescription(
  seats: CalendarSeat[],
  songs: CalendarSong[],
  catalog: TeamRoleDef[],
  link: string,
  mdUserId?: string | null
): string {
  const order = new Map(orderedRoles(catalog).map((r, i) => [r.key, i]));
  const rank = (key: string) => order.get(key) ?? Number.MAX_SAFE_INTEGER;
  const byRole = new Map<string, string[]>();
  for (const s of [...seats].sort(
    (a, b) => rank(a.role) - rank(b.role) || a.role.localeCompare(b.role)
  )) {
    const names = byRole.get(s.role) ?? [];
    names.push(mdUserId && s.userId === mdUserId ? `${s.name} (MD)` : s.name);
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

/**
 * Each guest's answer to "do you want Google's emails about this?", by
 * address. A person holding two seats appears once; the seats carry the same
 * flag, since it is global to the person, and a mid-handoff seat reads the old
 * owner's preference along with their address.
 */
function emailPreferences(seats: CalendarSeat[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const s of seats) {
    const email = normalizeEmail(s.email);
    if (!email) continue;
    out.set(email, (out.get(email) ?? false) || s.calendarInviteEmails !== false);
  }
  return out;
}

/**
 * Split a guest list into the people who want Google's emails and the people
 * who asked to be invited WITHOUT them.
 *
 * `sendUpdates` is per REQUEST, not per attendee: there is no way to add one
 * guest quietly while emailing another in the same write. What can be done is
 * to write them in two passes — invite the ones who want an email, then add
 * the rest with `sendUpdates=none`. That is exact for a NEW event, which is
 * where the invite email anyone actually notices comes from, and is the whole
 * reason this split exists (see `syncOneEvent`).
 *
 * An address with no seat behind it (nobody we can read a preference from)
 * counts as wanting emails, since that is Google's own default.
 */
export function splitInviteEmails(
  attendees: CalendarAttendee[],
  seats: CalendarSeat[]
): { emailed: CalendarAttendee[]; silent: CalendarAttendee[] } {
  const prefs = emailPreferences(seats);
  const emailed: CalendarAttendee[] = [];
  const silent: CalendarAttendee[] = [];
  for (const a of attendees) {
    const email = normalizeEmail(a.email);
    (email !== null && prefs.get(email) === false ? silent : emailed).push(a);
  }
  return { emailed, silent };
}

/**
 * `sendUpdates` for a patch of an existing event: does Google email the guests
 * about this change?
 *
 * The honest reading of a per-person preference against a per-request
 * parameter. In order:
 *
 *  • nobody on the event wants emails → "none", whatever changed;
 *  • the time moved → "all", because that is the change people need told and
 *    it affects every guest alike;
 *  • somebody was dropped → "all": their copy has to be cancelled, and their
 *    seat is gone so we no longer hold their preference;
 *  • the only change is people joining and NONE of them wants an email →
 *    "none". This is the case that makes the setting worth having: being added
 *    to a set is what generates the mail, and it can be suppressed exactly.
 *    The cost is that the guests already on the event aren't told either —
 *    Google cannot email a subset, so the choice is all of them or none;
 *  • anything else → "all".
 *
 * So one person's opt-out cannot be honoured when the same change also
 * concerns somebody who wants emails, or when the time moves. That is a limit
 * of the API, not of this function.
 */
export function notifyForUpdate(
  before: CalendarAttendee[],
  after: CalendarAttendee[],
  seats: CalendarSeat[],
  moved: boolean
): "all" | "none" {
  const prefs = emailPreferences(seats);
  const wants = (email: string) => prefs.get(email) !== false;

  const guestWants = after.some((a) => {
    const email = normalizeEmail(a.email);
    return email !== null && wants(email);
  });
  if (!guestWants) return "none";
  if (moved) return "all";
  if (!attendeesChanged(before, after)) return "none";

  const was = new Set(before.flatMap((a) => normalizeEmail(a.email) ?? []));
  const is = new Set(after.flatMap((a) => normalizeEmail(a.email) ?? []));
  const removed = [...was].filter((e) => !is.has(e));
  if (removed.length > 0) return "all";
  const added = [...is].filter((e) => !was.has(e));
  return added.every((e) => !wants(e)) ? "none" : "all";
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
 * A practice's start/end in the app's zone. Its own function because a
 * practice stores two instants rather than a start and a length — there is no
 * duration to add, which is the whole point.
 */
export function practiceTimes(
  practice: { startsAt: Date; endsAt: Date },
  timeZone: string
) {
  return {
    start: { dateTime: practice.startsAt.toISOString(), timeZone },
    end: { dateTime: practice.endsAt.toISOString(), timeZone },
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
