// Unit tests for lib/calendarEvent — what a set's Google Calendar event says,
// who it invites, and which seats an RSVP confirms.
import { describe, expect, it } from "vitest";
import {
  attendeesChanged,
  eventAttendees,
  eventDescription,
  eventTimes,
  eventTitle,
  inviteAddress,
  normalizeEmail,
  seatsToConfirm,
  type CalendarSeat,
} from "@/lib/calendarEvent";
import { DEFAULT_TEAM_ROLES, type TeamRoleDef } from "@/lib/teamRoles";

const seat = (role: string, name: string, email: string | null, userId = name): CalendarSeat => ({
  role,
  userId,
  name,
  email,
});

describe("eventTitle", () => {
  it("uses the set's label, falling back for an unnamed set", () => {
    expect(eventTitle({ label: "Sunday Morning" })).toBe("Sunday Morning");
    expect(eventTitle({ label: null })).toBe("Worship set");
    expect(eventTitle({ label: "   " })).toBe("Worship set");
  });
});

describe("eventDescription", () => {
  const catalog: TeamRoleDef[] = [
    { key: "WL", label: "Worship leader", defaultCount: 1, adminOnly: false, order: 0 },
    { key: "KEYS", label: "Keys", defaultCount: 1, adminOnly: false, order: 1 },
    { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 2 },
  ];

  it("lists the roster in the team's role order, then the setlist and link", () => {
    const text = eventDescription(
      [seat("DRUMS", "Bob", null), seat("WL", "Nina", null), seat("KEYS", "Kate", null)],
      [
        { title: "Who Else", key: "E" },
        { title: "Gratitude", key: null },
      ],
      catalog,
      "https://app.test/calendar?set=s1"
    );
    expect(text).toBe(
      [
        "Roster",
        "Worship leader: Nina",
        "Keys: Kate",
        "Drums: Bob",
        "",
        "Setlist",
        "1. Who Else (E)",
        "2. Gratitude",
        "",
        "Open this set in TapWorship: https://app.test/calendar?set=s1",
      ].join("\n")
    );
  });

  it("groups several people in one role and leaves out an empty setlist", () => {
    const text = eventDescription(
      [seat("KEYS", "Kate", null), seat("KEYS", "Sam", null)],
      [],
      catalog,
      "https://x"
    );
    expect(text).toContain("Keys: Kate, Sam");
    expect(text).not.toContain("Setlist");
  });

  it("says so when nobody is scheduled, and names a role the team has since deleted", () => {
    expect(eventDescription([], [], DEFAULT_TEAM_ROLES, "https://x")).toContain(
      "Nobody scheduled yet"
    );
    expect(
      eventDescription([seat("SOUND_BOOTH", "Ari", null)], [], catalog, "https://x")
    ).toContain("Sound Booth: Ari");
  });
});

describe("eventAttendees", () => {
  it("invites each person with an email once, however many roles they hold", () => {
    const out = eventAttendees([
      seat("KEYS", "Kate", "Kate@Example.com"),
      seat("CHOIR", "Kate", "kate@example.com"),
      seat("DRUMS", "Bob", null),
    ]);
    expect(out).toEqual([{ email: "kate@example.com", displayName: "Kate" }]);
  });

  it("leaves out anyone who switched invites off, and drops them from an event they were on", () => {
    const seats = [
      { ...seat("KEYS", "Kate", "kate@example.com"), calendarInvites: false },
      seat("BASS", "Sam", "sam@example.com"),
    ];
    // Kate keeps her seat and stays in the description's roster; she is just
    // not a guest. Sending this list to Google is what uninvites her.
    expect(eventAttendees(seats, [{ email: "kate@example.com", responseStatus: "accepted" }])).toEqual([
      { email: "sam@example.com", displayName: "Sam" },
    ]);
    expect(eventDescription(seats, [], DEFAULT_TEAM_ROLES, "https://x")).toContain("Kate");
  });

  it("invites anyone whose preference isn't given — being invited is the default", () => {
    expect(eventAttendees([seat("KEYS", "Kate", "kate@example.com")])).toEqual([
      { email: "kate@example.com", displayName: "Kate" },
    ]);
    expect(
      eventAttendees([{ ...seat("KEYS", "Kate", "kate@example.com"), calendarInvites: true }])
    ).toEqual([{ email: "kate@example.com", displayName: "Kate" }]);
  });

  it("keeps the answer Google already has for anyone staying on", () => {
    const out = eventAttendees(
      [seat("KEYS", "Kate", "kate@example.com"), seat("BASS", "Sam", "sam@example.com")],
      [
        { email: "KATE@example.com", responseStatus: "accepted" },
        { email: "gone@example.com", responseStatus: "declined" },
      ]
    );
    expect(out).toEqual([
      { email: "kate@example.com", displayName: "Kate", responseStatus: "accepted" },
      { email: "sam@example.com", displayName: "Sam" },
    ]);
  });
});

describe("attendeesChanged", () => {
  it("ignores case and order, and catches an add, a drop or a swap", () => {
    const a = [{ email: "a@x.com" }, { email: "B@x.com" }];
    expect(attendeesChanged(a, [{ email: "b@x.com" }, { email: "a@x.com" }])).toBe(false);
    expect(attendeesChanged(a, [{ email: "a@x.com" }])).toBe(true);
    expect(attendeesChanged(a, [...a, { email: "c@x.com" }])).toBe(true);
    expect(attendeesChanged(a, [{ email: "a@x.com" }, { email: "c@x.com" }])).toBe(true);
  });
});

describe("eventTimes", () => {
  it("ends the event durationMinutes after it starts, in the given zone", () => {
    const startsAt = new Date("2026-10-25T16:00:00Z");
    expect(eventTimes({ startsAt, durationMinutes: 150 }, "America/Los_Angeles")).toEqual({
      start: { dateTime: "2026-10-25T16:00:00.000Z", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-10-25T18:30:00.000Z", timeZone: "America/Los_Angeles" },
    });
  });
});

describe("seatsToConfirm", () => {
  const attendees = [
    { email: "kate@example.com", responseStatus: "accepted" },
    { email: "sam@example.com", responseStatus: "declined" },
    { email: "ari@example.com", responseStatus: "tentative" },
    { email: "bob@example.com", responseStatus: "needsAction" },
  ];

  it("confirms only PENDING seats whose holder accepted", () => {
    expect(
      seatsToConfirm(attendees, [
        { id: "a1", status: "PENDING", email: "KATE@example.com" },
        { id: "a2", status: "PENDING", email: "sam@example.com" },
        { id: "a3", status: "PENDING", email: "ari@example.com" },
        { id: "a4", status: "PENDING", email: "bob@example.com" },
        { id: "a5", status: "PENDING", email: null },
      ])
    ).toEqual(["a1"]);
  });

  it("ignores a stale accepted answer from someone who has switched invites off", () => {
    // The write that drops them from the guest list and the notification
    // carrying their old RSVP can cross; an invite they asked not to have
    // doesn't get to confirm seats for them.
    expect(
      seatsToConfirm(attendees, [
        { id: "a1", status: "PENDING", email: "kate@example.com", calendarInvites: false },
        { id: "a2", status: "PENDING", email: "kate@example.com", calendarInvites: true },
      ])
    ).toEqual(["a2"]);
  });

  it("leaves a seat that's out for cover, mid-handoff or already confirmed", () => {
    expect(
      seatsToConfirm(attendees, [
        { id: "a1", status: "SWAP_REQUESTED", email: "kate@example.com" },
        { id: "a2", status: "PENDING_APPROVAL", email: "kate@example.com" },
        { id: "a3", status: "CONFIRMED", email: "kate@example.com" },
      ])
    ).toEqual([]);
  });

  it("confirms every role an accepted person holds on the set", () => {
    expect(
      seatsToConfirm(attendees, [
        { id: "keys", status: "PENDING", email: "kate@example.com" },
        { id: "choir", status: "PENDING", email: "kate@example.com" },
      ])
    ).toEqual(["keys", "choir"]);
  });
});

describe("inviteAddress", () => {
  it("prefers the calendar address someone nominated over their account email", () => {
    expect(
      inviteAddress({
        email: "kate@example.com",
        calendarInviteEmail: "Sets@group.calendar.google.com",
      })
    ).toBe("sets@group.calendar.google.com");
  });

  it("falls back to the account email when none is nominated", () => {
    expect(inviteAddress({ email: "kate@example.com" })).toBe("kate@example.com");
    expect(
      inviteAddress({ email: "kate@example.com", calendarInviteEmail: null })
    ).toBe("kate@example.com");
    // A blank override is not an address — it reads as "use my email".
    expect(
      inviteAddress({ email: "kate@example.com", calendarInviteEmail: "  " })
    ).toBe("kate@example.com");
  });

  it("is nobody to invite when there is neither", () => {
    expect(inviteAddress({ email: null })).toBeNull();
    expect(inviteAddress({ email: null, calendarInviteEmail: "" })).toBeNull();
  });

  // A nominated calendar is a place to send to, with or without an account
  // email: the RSVP comes back from it just the same.
  it("stands on its own when there's no account email", () => {
    expect(
      inviteAddress({ email: null, calendarInviteEmail: "sets@group.calendar.google.com" })
    ).toBe("sets@group.calendar.google.com");
  });
});

describe("normalizeEmail", () => {
  it("trims and lower-cases, and treats blank as none", () => {
    expect(normalizeEmail("  Kate@Example.COM ")).toBe("kate@example.com");
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });
});
