// Pure profile-editing rules (unit-tested in tests/unit/profile.test.ts).
import { inviteAddress } from "./calendarEvent";

/** The /profile fields that decide a person's place on their sets' events. */
export interface CalendarProfile {
  email: string | null;
  calendarInviteEmail?: string | null;
  calendarInvites: boolean;
}

/**
 * The email to persist when a user saves their profile.
 *
 * Google (OAuth-only) accounts sign in with their Google email, so it is NOT
 * user-editable: any email in the request is ignored and the stored value is
 * kept. Password accounts may change it freely; an empty value clears it.
 *
 * `hasPassword` is how we tell the two apart — OAuth-only accounts are created
 * with no password hash (mirrored on the client as the disabled email field).
 */
export function resolveProfileEmail(
  hasPassword: boolean,
  currentEmail: string | null,
  requestedEmail: string | null | undefined
): string | null {
  if (!hasPassword) return currentEmail;
  return requestedEmail || null;
}

/**
 * Whether saving a profile has to re-sync the person's upcoming sets on the
 * org's Google Calendar.
 *
 * Three fields reach the guest list. The EMAIL is the address an invite goes
 * to, so a new one has to be invited and a cleared one dropped — and so does a
 * new INVITE ADDRESS, which overrides it (`inviteAddress`), since changing
 * where the invites go means withdrawing the old ones and sending them again.
 * Comparing the resolved address rather than the two fields is what keeps a
 * no-op out: setting the override to the same address it already resolved to
 * changes nothing Google holds. The INVITES switch
 * is the person asking to be a guest or not: switching it back ON is how the
 * invites arrive, so that always re-syncs.
 *
 * Switching it OFF is the one case that asks a question, because it could mean
 * either "no more of these" or "and take me off the ones I've already got".
 * The /profile modal asks which, and `withdrawInvites` is the answer — only a
 * yes re-syncs the sets they're already a guest on. A no leaves those events
 * exactly as they are and the opt-out applies from here on.
 *
 * Everything else on the page (name, password, digest) changes nothing Google
 * holds, and a re-sync emails the whole team, so it is not run for them.
 */
export function calendarResyncNeeded(
  before: CalendarProfile,
  after: CalendarProfile,
  withdrawInvites = false
): boolean {
  if (inviteAddress(before) !== inviteAddress(after)) return true;
  if (!before.calendarInvites && after.calendarInvites) return true;
  // The withdrawal arrives as its own save, so by then the switch is already
  // off and unchanged — it's the request that matters, not a flip.
  return withdrawInvites && !after.calendarInvites;
}
