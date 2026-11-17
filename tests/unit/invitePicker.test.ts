// Unit tests for lib/invitePicker — /profile's "Send invites to" picker.
//
// The thing worth protecting here is that the picker can always SHOW what is
// actually in force. An address that isn't one of your calendars is still
// where your invites are going, and a picker that quietly displayed the
// default instead would have you believe you'd fixed something you hadn't.
import { describe, expect, it } from "vitest";
import {
  INVITE_DEFAULT_VALUE,
  INVITE_OTHER_VALUE,
  inviteOptions,
  inviteSelectionValue,
  selectedInviteValue,
  type PickerCalendar,
} from "@/lib/invitePicker";

const ME = "dylan@example.com";

const cals: PickerCalendar[] = [
  { id: ME, name: "dylan@example.com", primary: true },
  { id: "abc123@group.calendar.google.com", name: "Worship sets", primary: false },
  { id: "def456@group.calendar.google.com", name: "Family", primary: false },
];

describe("inviteOptions", () => {
  it("leads with the account's own calendar, named by its address", () => {
    const [first] = inviteOptions(cals, ME, null);
    expect(first.value).toBe(INVITE_DEFAULT_VALUE);
    expect(first.label).toContain(ME);
  });

  it("doesn't list the primary calendar twice", () => {
    const opts = inviteOptions(cals, ME, null);
    // Its address IS the account email, so a second option for it would store
    // a value that resolves to exactly what the default already means.
    expect(opts.filter((o) => o.value === ME)).toHaveLength(0);
    expect(opts.map((o) => o.label)).toContain("Worship sets");
  });

  it("ends with the way out of the list", () => {
    const opts = inviteOptions(cals, ME, null);
    expect(opts[opts.length - 1].value).toBe(INVITE_OTHER_VALUE);
  });

  it("keeps an option for a saved address no calendar answers to", () => {
    const opts = inviteOptions(cals, ME, "sets@otherdomain.com");
    expect(opts.map((o) => o.value)).toContain("sets@otherdomain.com");
  });

  it("doesn't duplicate a saved address the list already offers", () => {
    const id = "abc123@group.calendar.google.com";
    const opts = inviteOptions(cals, ME, id);
    expect(opts.filter((o) => o.value === id)).toHaveLength(1);
  });

  it("works with no calendars at all — the default and the box", () => {
    const opts = inviteOptions([], "", null);
    expect(opts.map((o) => o.value)).toEqual([
      INVITE_DEFAULT_VALUE,
      INVITE_OTHER_VALUE,
    ]);
  });
});

describe("selectedInviteValue", () => {
  it("nothing stored is the default", () => {
    const opts = inviteOptions(cals, ME, null);
    expect(selectedInviteValue(opts, null)).toBe(INVITE_DEFAULT_VALUE);
    expect(selectedInviteValue(opts, "  ")).toBe(INVITE_DEFAULT_VALUE);
  });

  it("selects the calendar a stored address names", () => {
    const id = "def456@group.calendar.google.com";
    expect(selectedInviteValue(inviteOptions(cals, ME, id), id)).toBe(id);
  });

  it("matches regardless of case, the way an address does", () => {
    const id = "ABC123@group.calendar.google.com";
    const opts = inviteOptions(cals, ME, null);
    expect(selectedInviteValue(opts, id)).toBe(
      "abc123@group.calendar.google.com"
    );
  });

  it("falls back to the address box only when no option covers the value", () => {
    const opts = inviteOptions(cals, ME, null);
    expect(selectedInviteValue(opts, "typed@example.com")).toBe(
      INVITE_OTHER_VALUE
    );
  });
});

describe("inviteSelectionValue", () => {
  it("a calendar saves its address", () => {
    expect(inviteSelectionValue("abc@group.calendar.google.com")).toBe(
      "abc@group.calendar.google.com"
    );
  });

  it("the default saves the empty value that means the account email", () => {
    expect(inviteSelectionValue(INVITE_DEFAULT_VALUE)).toBe("");
  });

  it("picking the address box saves nothing yet", () => {
    // It opens the box and waits for an answer — writing here would move
    // everyone's invites to an address nobody has typed.
    expect(inviteSelectionValue(INVITE_OTHER_VALUE)).toBeNull();
  });
});
