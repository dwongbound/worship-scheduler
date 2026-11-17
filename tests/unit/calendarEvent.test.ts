// Unit tests for lib/calendarEvent — what a set's Google Calendar event says,
// who it invites, and which seats an RSVP confirms.
import { describe, expect, it } from "vitest";
import {
  attendeesChanged,
  eventAttendees,
  eventDescription,
  eventTimes,
  practiceTimes,
  practiceTitle,
  eventTitle,
  inviteAddress,
  normalizeEmail,
  notifyForUpdate,
  seatsToConfirm,
  splitInviteEmails,
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

describe("practiceTitle", () => {
  it("names the practice after its set, prefixed so it can't read as the set", () => {
    expect(practiceTitle({ label: "Sunday Morning" })).toBe("(Practice) Sunday Morning");
    expect(practiceTitle({ label: null })).toBe("(Practice) Worship set");
  });
});

describe("eventDescription", () => {
  const catalog: TeamRoleDef[] = [
    { key: "WL", label: "Worship leader", defaultCount: 1, adminOnly: false, order: 0 },
    { key: "KEYS", label: "Keys", defaultCount: 1, adminOnly: false, order: 1 },
    { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 2 },
  ];

  it("marks the set's MD, and nobody when the set has none", () => {
    const seats = [seat("KEYS", "Kate", null), seat("DRUMS", "Bob", null)];
    const withMd = eventDescription(seats, [], catalog, "https://x", "Kate");
    expect(withMd).toContain("Keys: Kate (MD)");
    expect(withMd).toContain("Drums: Bob");
    expect(withMd.match(/\(MD\)/g)).toHaveLength(1);
    expect(eventDescription(seats, [], catalog, "https://x")).not.toContain("(MD)");
  });

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

describe("splitInviteEmails", () => {
  // Google's sendUpdates is per request, so a mixed roster has to be written
  // in two passes — this is the split those passes are made from.
  const quiet = (sx: CalendarSeat) => ({ ...sx, calendarInviteEmails: false });

  it("puts the people who want no email in their own group", () => {
    const seats = [
      quiet(seat("KEYS", "Kate", "kate@example.com")),
      seat("BASS", "Sam", "sam@example.com"),
    ];
    const out = splitInviteEmails(eventAttendees(seats), seats);
    expect(out.emailed.map((a) => a.email)).toEqual(["sam@example.com"]);
    expect(out.silent.map((a) => a.email)).toEqual(["kate@example.com"]);
  });

  it("treats an address with no seat behind it as wanting emails", () => {
    // Google's own default, and the safe way round: a guest we can't read a
    // preference for still hears about their invite.
    const out = splitInviteEmails([{ email: "stranger@example.com" }], []);
    expect(out.silent).toEqual([]);
    expect(out.emailed).toHaveLength(1);
  });

  it("counts someone holding two seats once", () => {
    const seats = [
      quiet(seat("KEYS", "Kate", "kate@example.com")),
      quiet(seat("CHOIR", "Kate", "kate@example.com")),
    ];
    const out = splitInviteEmails(eventAttendees(seats), seats);
    expect(out.emailed).toEqual([]);
    expect(out.silent).toHaveLength(1);
  });
});

describe("notifyForUpdate", () => {
  const kate = { email: "kate@example.com" };
  const sam = { email: "sam@example.com" };
  const wants = [seat("KEYS", "Kate", "kate@example.com"), seat("BASS", "Sam", "sam@example.com")];
  const kateQuiet = [
    { ...seat("KEYS", "Kate", "kate@example.com"), calendarInviteEmails: false },
    seat("BASS", "Sam", "sam@example.com"),
  ];

  it("keeps the old behaviour when nobody has opted out", () => {
    // Guest list changed, or the time moved → everyone is told. A setlist-only
    // edit (same guests, same time) stays quiet, as before.
    expect(notifyForUpdate([sam], [sam, kate], wants, false)).toBe("all");
    expect(notifyForUpdate([sam, kate], [sam, kate], wants, true)).toBe("all");
    expect(notifyForUpdate([sam, kate], [sam, kate], wants, false)).toBe("none");
  });

  it("says nothing when the only person joining asked for no email", () => {
    // THE case this setting exists for: being added to a set is what generates
    // the mail, and here it is suppressed exactly.
    expect(notifyForUpdate([sam], [sam, kate], kateQuiet, false)).toBe("none");
  });

  it("still emails when somebody who wants it is part of the same change", () => {
    // Google cannot mail a subset, so Sam joining means Sam is told — and
    // Kate, already a guest, is copied. The limit is the API's.
    const both = [
      ...kateQuiet,
      seat("DRUMS", "Dee", "dee@example.com"),
    ];
    const dee = { email: "dee@example.com" };
    expect(notifyForUpdate([sam], [sam, kate, dee], both, false)).toBe("all");
  });

  it("emails on a move even when the person who joined wanted silence", () => {
    expect(notifyForUpdate([sam], [sam, kate], kateQuiet, true)).toBe("all");
  });

  it("emails when somebody was dropped", () => {
    // Their copy has to be cancelled, and their seat is gone so there is no
    // preference left to read.
    expect(notifyForUpdate([sam, kate], [sam], kateQuiet, false)).toBe("all");
  });

  it("says nothing at all when no guest wants emails, whatever changed", () => {
    const allQuiet = kateQuiet.map((sx) => ({ ...sx, calendarInviteEmails: false }));
    expect(notifyForUpdate([kate], [kate, sam], allQuiet, true)).toBe("none");
    expect(notifyForUpdate([kate, sam], [kate], allQuiet, false)).toBe("none");
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

describe("practiceTimes", () => {
  it("takes both ends from the practice — there is no duration to add", () => {
    expect(
      practiceTimes(
        {
          startsAt: new Date("2026-11-04T19:00:00Z"),
          endsAt: new Date("2026-11-04T21:00:00Z"),
        },
        "America/Los_Angeles"
      )
    ).toEqual({
      start: { dateTime: "2026-11-04T19:00:00.000Z", timeZone: "America/Los_Angeles" },
      end: { dateTime: "2026-11-04T21:00:00.000Z", timeZone: "America/Los_Angeles" },
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
