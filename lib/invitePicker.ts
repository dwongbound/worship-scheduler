// /profile's "Send invites to" picker, as pure rules (unit-tested in
// tests/unit/invitePicker.test.ts).
//
// Google puts an invite on the default calendar of whatever ADDRESS it was
// sent to, and an attendee can't move an invited event afterwards — so the
// address is the only choice of calendar there is (lib/calendarEvent.ts
// `inviteAddress`). A secondary calendar's own address is its id, which is why
// picking a calendar here and pasting an address are the same act with two
// faces: one is a list, the other is the way out when the list can't help.
//
// The list comes from the person's own Google account, behind the one consent
// the availability import already asks for. This file is the part that doesn't
// need Google: which options to draw, which one is selected, and what a
// selection means for the stored value.

/**
 * One of the person's own calendars, as the picker needs it — structurally
 * the `ImportCalendar` lib/googleAvailability returns, declared here so the
 * client page can take this list without importing a server module.
 */
export interface PickerCalendar {
  id: string;
  name: string;
  primary: boolean;
}

/** The option that means "wherever my account email's invites already land". */
export const INVITE_DEFAULT_VALUE = "";

/**
 * The option that reveals the address box.
 *
 * The box is the fallback the list can't replace: a calendar someone else owns
 * and shared with you isn't in the list (it isn't yours), a work account's
 * calendar isn't on the account you signed in with, and the list needs a
 * permission that can be refused. Typing an address works in all three.
 */
export const INVITE_OTHER_VALUE = "__other__";

export interface InviteOption {
  value: string;
  label: string;
}

/**
 * The picker's options, in the order they're drawn.
 *
 * The account's own calendar leads, as the default and the thing most people
 * want. The PRIMARY calendar is deliberately not listed again under its own
 * name: its address IS the account email, so a second option for it would
 * store a value that resolves to exactly what blank already means.
 *
 * A saved address that no calendar in the list answers to keeps its own
 * option, so the picker can show what is actually in force. That covers an
 * address typed by hand, and a calendar that has since been deleted or whose
 * sharing was revoked — in both cases the invites really are still going
 * there, and a picker that silently showed the default would be lying.
 */
export function inviteOptions(
  calendars: PickerCalendar[],
  accountEmail: string,
  saved: string | null
): InviteOption[] {
  const out: InviteOption[] = [
    {
      value: INVITE_DEFAULT_VALUE,
      label: accountEmail
        ? `My main calendar (${accountEmail})`
        : "My main calendar",
    },
  ];
  const seen = new Set<string>([accountEmail.toLowerCase()]);
  for (const cal of calendars) {
    const key = cal.id.toLowerCase();
    if (cal.primary || seen.has(key)) continue;
    seen.add(key);
    out.push({ value: cal.id, label: cal.name });
  }
  const current = (saved ?? "").trim();
  if (current && !seen.has(current.toLowerCase())) {
    out.push({ value: current, label: current });
  }
  out.push({ value: INVITE_OTHER_VALUE, label: "Another address…" });
  return out;
}

/**
 * Which option a stored value selects.
 *
 * Nothing stored is the default. An address the options cover selects that
 * option — `inviteOptions` has already made one for a stored address the list
 * doesn't know, so this only falls through to the address box when the options
 * were built from a different value than the one being matched.
 */
export function selectedInviteValue(
  options: InviteOption[],
  saved: string | null
): string {
  const current = (saved ?? "").trim();
  if (!current) return INVITE_DEFAULT_VALUE;
  const hit = options.find(
    (o) =>
      o.value !== INVITE_OTHER_VALUE &&
      o.value.toLowerCase() === current.toLowerCase()
  );
  return hit ? hit.value : INVITE_OTHER_VALUE;
}

/**
 * What a chosen option saves, or `null` for "don't save yet".
 *
 * Picking "Another address…" is the one choice that isn't an answer — it opens
 * the box and waits for one, so nothing is written and the invites keep going
 * where they were. Everything else is a complete answer: a calendar's address,
 * or the empty string that means the account email.
 */
export function inviteSelectionValue(value: string): string | null {
  if (value === INVITE_OTHER_VALUE) return null;
  return value;
}
