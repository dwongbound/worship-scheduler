import { describe, expect, it } from "vitest";
import { calendarResyncNeeded, resolveProfileEmail } from "@/lib/profile";

describe("resolveProfileEmail", () => {
  // Password accounts may change their email freely.
  it("lets a password account set a new email", () => {
    expect(resolveProfileEmail(true, "old@x.com", "new@x.com")).toBe("new@x.com");
  });

  it("lets a password account clear its email (empty → null)", () => {
    expect(resolveProfileEmail(true, "old@x.com", "")).toBeNull();
    expect(resolveProfileEmail(true, "old@x.com", undefined)).toBeNull();
    expect(resolveProfileEmail(true, "old@x.com", null)).toBeNull();
  });

  // Google (OAuth-only) accounts can't change their email — the request is
  // ignored and the stored value is kept, even if a new one is submitted.
  it("keeps an OAuth-only account's email regardless of the request", () => {
    expect(resolveProfileEmail(false, "me@gmail.com", "hacker@x.com")).toBe(
      "me@gmail.com"
    );
    expect(resolveProfileEmail(false, "me@gmail.com", "")).toBe("me@gmail.com");
    expect(resolveProfileEmail(false, "me@gmail.com", undefined)).toBe(
      "me@gmail.com"
    );
  });

  it("preserves a null email on an OAuth-only account", () => {
    expect(resolveProfileEmail(false, null, "whatever@x.com")).toBeNull();
  });
});

describe("calendarResyncNeeded", () => {
  const was = { email: "me@x.com", calendarInvites: true };

  it("re-syncs when the invite address changes or goes away", () => {
    expect(calendarResyncNeeded(was, { ...was, email: "new@x.com" })).toBe(true);
    expect(calendarResyncNeeded(was, { ...was, email: null })).toBe(true);
    expect(
      calendarResyncNeeded({ ...was, email: null }, { ...was, email: "me@x.com" })
    ).toBe(true);
  });

  it("re-syncs when invites are switched back on — that's how they arrive", () => {
    expect(
      calendarResyncNeeded({ ...was, calendarInvites: false }, was)
    ).toBe(true);
  });

  // Switching OFF is the question /profile asks in a modal: the preference
  // alone stops future invites, and only a yes touches the ones already out.
  it("leaves the invites already sent alone unless asked to withdraw them", () => {
    expect(calendarResyncNeeded(was, { ...was, calendarInvites: false })).toBe(
      false
    );
    expect(
      calendarResyncNeeded(was, { ...was, calendarInvites: false }, true)
    ).toBe(true);
  });

  // The withdrawal is its own save, so by then the switch is already off and
  // unchanged — the request has to be enough on its own.
  it("withdraws on request even though nothing changed in that save", () => {
    const off = { email: "me@x.com", calendarInvites: false };
    expect(calendarResyncNeeded(off, off, true)).toBe(true);
    expect(calendarResyncNeeded(off, off)).toBe(false);
  });

  it("never withdraws from someone who is still being invited", () => {
    expect(calendarResyncNeeded(was, was, true)).toBe(false);
  });

  // The override is where the invites actually go, so moving it withdraws
  // them from the old address and sends them to the new one.
  it("re-syncs when the invites are pointed at another calendar", () => {
    expect(
      calendarResyncNeeded(was, { ...was, calendarInviteEmail: "sets@group.calendar.google.com" })
    ).toBe(true);
    expect(
      calendarResyncNeeded({ ...was, calendarInviteEmail: "sets@group.calendar.google.com" }, was)
    ).toBe(true);
  });

  // It's the RESOLVED address that matters: an override naming the address
  // already in use changes nothing Google holds, and a re-sync emails the
  // whole team.
  it("ignores an override that resolves to the address already in use", () => {
    expect(
      calendarResyncNeeded(was, { ...was, calendarInviteEmail: "ME@x.com" })
    ).toBe(false);
  });

  // And with an override set, the account email underneath it is no longer
  // where anything is sent.
  it("ignores the account email while an override is in force", () => {
    const pointed = { ...was, calendarInviteEmail: "sets@group.calendar.google.com" };
    expect(calendarResyncNeeded(pointed, { ...pointed, email: "other@x.com" })).toBe(
      false
    );
  });

  it("stays quiet when neither changed — a re-sync emails the whole team", () => {
    expect(calendarResyncNeeded(was, { ...was })).toBe(false);
    expect(
      calendarResyncNeeded(
        { email: null, calendarInvites: false },
        { email: null, calendarInvites: false }
      )
    ).toBe(false);
  });
});
