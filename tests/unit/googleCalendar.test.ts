// Unit tests for lib/googleCalendar — the Google side of the set ⇄ event sync.
// prisma and fetch are mocked, so nothing touches a db or Google: each test
// checks which calls the sync makes (create vs patch, who's emailed) and what
// an RSVP ping does to the roster.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    set: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    org: { findUnique: vi.fn(), update: vi.fn() },
    user: { findMany: vi.fn() },
    assignment: { findMany: vi.fn(), updateMany: vi.fn() },
    setPractice: { findUnique: vi.fn(), update: vi.fn() },
    setHistoryEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/teamRoleStore", () => ({
  getTeamCatalog: vi.fn(async () => (await import("@/lib/teamRoles")).DEFAULT_TEAM_ROLES),
}));
vi.mock("@/lib/pendingHandoff", () => ({ pendingOwners: vi.fn(async () => new Map()) }));

import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";
import { pendingOwners } from "@/lib/pendingHandoff";
import {
  calendarEventOfPractice,
  calendarEventsOfSet,
  handleNotification,
  isGoogleCalendarAppConfigured,
  listCalendarsFor,
  maintainCalendarWatches,
  selectCalendar,
  signState,
  syncSetCalendar,
  verifyState,
} from "@/lib/googleCalendar";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;

const NOW = new Date("2026-10-20T12:00:00Z");
const LATER = new Date("2026-10-25T16:00:00Z");

let calls: { method: string; url: string; body: unknown }[];
let routes: (method: string, url: string) => { status?: number; body?: unknown } | undefined;

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: "org1",
    name: "Grace",
    googleCalRefreshToken: encryptSecret("refresh"),
    googleCalendarId: "cal1",
    googleCalSyncToken: "tok1",
    googleCalChannelId: "chan1",
    googleCalResourceId: "res1",
    googleCalChannelExpiresAt: new Date("2026-10-26T00:00:00Z"),
    ...overrides,
  };
}

function aSet(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    label: "Sunday Morning",
    startsAt: LATER,
    durationMinutes: 120,
    orgId: "org1",
    teamId: "t1",
    googleEventId: null,
    songs: [{ title: "Who Else", key: "E" }],
    practices: [],
    assignments: [
      {
        id: "a1",
        role: "KEYS",
        status: "PENDING",
        pendingCoverFromUserId: null,
        userId: "u1",
        user: { name: "Kate", email: "kate@example.com" },
      },
      {
        id: "a2",
        role: "DRUMS",
        status: "CONFIRMED",
        pendingCoverFromUserId: null,
        userId: "u2",
        user: { name: "Bob", email: null },
      },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.NEXTAUTH_URL = "https://app.test";
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "csecret";
  calls = [];
  routes = () => undefined;
  m(prisma.org.findUnique).mockResolvedValue(org());
  m(prisma.user.findMany).mockResolvedValue([]);
  m(prisma.$transaction).mockResolvedValue([]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { method?: string; body?: string } = {}) => {
      const method = init.method ?? "GET";
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }));
      }
      calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
      const r = routes(method, url) ?? {};
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("OAuth state", () => {
  it("round-trips the org and user, and rejects tampering or expiry", () => {
    const token = signState("org1", "u1");
    expect(verifyState(token)).toEqual({ orgId: "org1", userId: "u1" });
    const [payload, sig] = token.split(".");
    expect(verifyState(`${payload}x.${sig}`)).toBeNull();
    expect(verifyState(`${payload}.${sig.slice(1)}`)).toBeNull();
    const old = signState("org1", "u1", 60);
    vi.setSystemTime(new Date(NOW.getTime() + 120_000));
    expect(verifyState(old)).toBeNull();
  });
});

describe("syncSetCalendar", () => {
  it("does nothing for an org that hasn't connected", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet());
    m(prisma.org.findUnique).mockResolvedValue(org({ googleCalRefreshToken: null }));
    await syncSetCalendar("s1");
    expect(calls).toEqual([]);
  });

  it("leaves a set that has already happened alone", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet({ startsAt: new Date("2026-10-19T00:00:00Z") }));
    await syncSetCalendar("s1");
    expect(calls).toEqual([]);
  });

  it("creates the event, invites everyone with an email, and remembers its id", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet());
    routes = (method) => (method === "POST" ? { body: { id: "ev1" } } : undefined);
    await syncSetCalendar("s1");

    expect(calls).toHaveLength(1);
    const [create] = calls;
    expect(create.method).toBe("POST");
    expect(create.url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/cal1/events?sendUpdates=all"
    );
    const body = create.body as Record<string, unknown>;
    expect(body.summary).toBe("Sunday Morning");
    expect(body.attendees).toEqual([{ email: "kate@example.com", displayName: "Kate" }]);
    expect(body.extendedProperties).toEqual({ private: { tapworshipSetId: "s1" } });
    expect(body.description).toContain("1. Who Else (E)");
    expect(body.description).toContain("https://app.test/calendar?set=s1");
    expect(prisma.set.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { googleEventId: "ev1" },
    });
  });

  it("patches quietly when only the setlist changed, keeping each RSVP", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet({ googleEventId: "ev1" }));
    routes = (method) =>
      method === "GET"
        ? {
            body: {
              status: "confirmed",
              start: { dateTime: LATER.toISOString() },
              attendees: [{ email: "kate@example.com", responseStatus: "accepted" }],
            },
          }
        : undefined;
    await syncSetCalendar("s1");

    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("/events/ev1?sendUpdates=none");
    expect((patch.body as { attendees: unknown }).attendees).toEqual([
      { email: "kate@example.com", displayName: "Kate", responseStatus: "accepted" },
    ]);
  });

  it("emails guests when the time moves or someone is added", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet({ googleEventId: "ev1" }));
    routes = (method) =>
      method === "GET"
        ? {
            body: {
              status: "confirmed",
              start: { dateTime: "2026-10-25T15:00:00.000Z" },
              attendees: [{ email: "kate@example.com", responseStatus: "accepted" }],
            },
          }
        : undefined;
    await syncSetCalendar("s1");
    expect(calls.find((c) => c.method === "PATCH")!.url).toContain("sendUpdates=all");
  });

  it("makes a new event when the old one was deleted in Google", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet({ googleEventId: "ev1" }));
    routes = (method) =>
      method === "GET" ? { status: 404 } : method === "POST" ? { body: { id: "ev2" } } : undefined;
    await syncSetCalendar("s1");
    expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
    expect(prisma.set.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { googleEventId: "ev2" },
    });
  });

  it("keeps a seat awaiting approval on the person handing it over", async () => {
    m(prisma.set.findUnique).mockResolvedValue(
      aSet({
        assignments: [
          {
            id: "a1",
            role: "KEYS",
            status: "PENDING_APPROVAL",
            pendingCoverFromUserId: "u9",
            userId: "u1",
            user: { name: "Kate", email: "kate@example.com" },
          },
        ],
      })
    );
    m(pendingOwners).mockResolvedValueOnce(new Map([["a1", { id: "u9", name: "Nina", isMD: false }]]));
    m(prisma.user.findMany).mockResolvedValue([{ id: "u9", email: "nina@example.com" }]);
    routes = (method) => (method === "POST" ? { body: { id: "ev1" } } : undefined);
    await syncSetCalendar("s1");
    expect((calls[0].body as { attendees: unknown }).attendees).toEqual([
      { email: "nina@example.com", displayName: "Nina" },
    ]);
  });

  it("never throws when Google is down", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(syncSetCalendar("s1")).resolves.toBeUndefined();
  });
});

describe("practices on a set", () => {
  // A practice is an extra event for the SAME people, so it rides along on the
  // set's own sync — one load, one roster, one description.
  const practice = (overrides: Record<string, unknown> = {}) => ({
    id: "p1",
    startsAt: new Date("2026-10-22T19:00:00Z"),
    endsAt: new Date("2026-10-22T21:00:00Z"),
    googleEventId: null,
    ...overrides,
  });

  it("creates the practice's own event alongside the set's", async () => {
    m(prisma.set.findUnique).mockResolvedValue(aSet({ practices: [practice()] }));
    routes = (method) => (method === "POST" ? { body: { id: "evX" } } : undefined);
    await syncSetCalendar("s1");

    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2);
    const [, made] = calls;
    const body = made.body as Record<string, unknown>;
    // Named after its set, and prefixed so the rehearsal never reads as the
    // service itself.
    expect(body.summary).toBe("Practice: Sunday Morning");
    // Same guests and same setlist as the service — that's what it rehearses.
    expect(body.attendees).toEqual([{ email: "kate@example.com", displayName: "Kate" }]);
    expect(body.description).toContain("1. Who Else (E)");
    expect(body.start).toEqual({
      dateTime: "2026-10-22T19:00:00.000Z",
      timeZone: expect.any(String),
    });
    expect(body.end).toEqual({
      dateTime: "2026-10-22T21:00:00.000Z",
      timeZone: expect.any(String),
    });
    expect(prisma.setPractice.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { googleEventId: "evX" },
    });
  });

  it("marks the practice's event as a practice, and NOT as the set", async () => {
    // applyRsvps keys off tapworshipSetId, so a rehearsal invite carrying it
    // would confirm somebody's seat on the service when they accepted.
    m(prisma.set.findUnique).mockResolvedValue(aSet({ practices: [practice()] }));
    routes = (method) => (method === "POST" ? { body: { id: "evX" } } : undefined);
    await syncSetCalendar("s1");

    const [set, rehearsal] = calls.map((c) => c.body as Record<string, unknown>);
    expect(set.extendedProperties).toEqual({ private: { tapworshipSetId: "s1" } });
    expect(rehearsal.extendedProperties).toEqual({
      private: { tapworshipPracticeId: "p1" },
    });
  });

  it("skips a rehearsal already behind an upcoming set", async () => {
    // A practice usually sits BEFORE its set, so this is the ordinary case the
    // morning after a Wednesday rehearsal — the Sunday still needs syncing.
    m(prisma.set.findUnique).mockResolvedValue(
      aSet({
        practices: [
          practice({ id: "past", endsAt: new Date("2026-10-19T21:00:00Z") }),
          practice({ id: "soon" }),
        ],
      })
    );
    routes = (method) => (method === "POST" ? { body: { id: "evX" } } : undefined);
    await syncSetCalendar("s1");

    expect(calls.filter((c) => c.method === "POST")).toHaveLength(2); // set + "soon"
    expect(prisma.setPractice.update).toHaveBeenCalledTimes(1);
    expect(prisma.setPractice.update).toHaveBeenCalledWith({
      where: { id: "soon" },
      data: { googleEventId: "evX" },
    });
  });

  it("patches an existing practice event instead of making a second one", async () => {
    m(prisma.set.findUnique).mockResolvedValue(
      aSet({
        googleEventId: "ev1",
        practices: [practice({ googleEventId: "evX" })],
      })
    );
    routes = (method) =>
      method === "GET"
        ? {
            body: {
              status: "confirmed",
              start: { dateTime: new Date("2026-10-22T19:00:00Z").toISOString() },
              attendees: [{ email: "kate@example.com", responseStatus: "accepted" }],
            },
          }
        : undefined;
    await syncSetCalendar("s1");

    const patches = calls.filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1].url).toContain("/events/evX");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("collects the set's event and its practices' for a delete", async () => {
    m(prisma.set.findUnique).mockResolvedValue({
      orgId: "org1",
      googleEventId: "ev1",
      practices: [{ googleEventId: "evX" }, { googleEventId: null }],
    });
    // The null one has nothing to cancel, so it's left out rather than
    // becoming a DELETE of "undefined".
    expect(await calendarEventsOfSet("s1")).toEqual([
      { orgId: "org1", eventId: "ev1" },
      { orgId: "org1", eventId: "evX" },
    ]);
  });

  it("reads one practice's event id for its own delete", async () => {
    m(prisma.setPractice.findUnique).mockResolvedValue({
      googleEventId: "evX",
      set: { orgId: "org1" },
    });
    expect(await calendarEventOfPractice("p1")).toEqual({ orgId: "org1", eventId: "evX" });
    m(prisma.setPractice.findUnique).mockResolvedValue({
      googleEventId: null,
      set: { orgId: "org1" },
    });
    expect(await calendarEventOfPractice("p1")).toBeNull();
  });
});

describe("isGoogleCalendarAppConfigured", () => {
  it("is on with just the OAuth client — no extra flag", () => {
    expect(isGoogleCalendarAppConfigured()).toBe(true);
  });

  it("keeps everything off without the OAuth client", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleCalendarAppConfigured()).toBe(false);
    expect(await maintainCalendarWatches()).toEqual({ renewed: 0, orgs: 0 });
    expect(await calendarEventsOfSet("s1")).toEqual([]);
    await handleNotification("chan1", "anything", "exists");
    expect(prisma.set.findUnique).not.toHaveBeenCalled();
    expect(prisma.org.findUnique).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe("choosing the calendar", () => {
  const list = {
    items: [
      { id: "work", summary: "Work" },
      { id: "me@example.com", summary: "me@example.com", primary: true },
      { id: "cal1", summary: "Grace worship sets" },
      { id: "gone", summary: "Old", deleted: true },
    ],
  };

  it("lists the writable calendars, main one first, deleted ones dropped", async () => {
    routes = (method, url) => (url.includes("/calendarList") ? { body: list } : undefined);
    expect(await listCalendarsFor("org1")).toEqual([
      { id: "me@example.com", name: "me@example.com", primary: true },
      { id: "cal1", name: "Grace worship sets", primary: false },
      { id: "work", name: "Work", primary: false },
    ]);
    // Only calendars events can be written to are asked for.
    expect(calls[0].url).toContain("minAccessRole=writer");
  });

  it("asks for a reconnect when the list scope wasn't granted", async () => {
    routes = () => ({ status: 403 });
    expect(await listCalendarsFor("org1")).toBe("scope");
  });

  it("refuses a calendar that isn't in the account's writable list", async () => {
    routes = (method, url) => (url.includes("/calendarList") ? { body: list } : undefined);
    expect(await selectCalendar("org1", "someone-elses")).toMatchObject({ ok: false });
    expect(prisma.org.update).not.toHaveBeenCalled();
  });

  it("moves upcoming sets: cancels their old events, forgets the ids, watches the new calendar", async () => {
    routes = (method, url) => {
      if (url.includes("/calendarList")) return { body: list };
      if (url.includes("/events/watch")) return { body: { resourceId: "res2" } };
      if (url.includes("/events?")) return { body: { items: [], nextSyncToken: "tok2" } };
      return undefined;
    };
    m(prisma.set.findMany).mockResolvedValue([{ id: "s1", googleEventId: "ev1" }]);
    expect(await selectCalendar("org1", "work")).toEqual({ ok: true, changed: true });

    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/calendars/cal1/events/ev1?sendUpdates=all"),
      })
    );
    expect(prisma.set.updateMany).toHaveBeenCalledWith({
      where: { orgId: "org1" },
      data: { googleEventId: null },
    });
    expect(prisma.org.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ googleCalendarId: "work", googleCalendarName: "Work" }),
      })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        url: expect.stringContaining("/calendars/work/events/watch"),
      })
    );
  });

  it("does nothing when the calendar is already the chosen one", async () => {
    expect(await selectCalendar("org1", "cal1")).toEqual({ ok: true, changed: false });
    expect(calls).toEqual([]);
  });
});

describe("handleNotification", () => {
  const eventPage = {
    items: [
      {
        status: "confirmed",
        extendedProperties: { private: { tapworshipSetId: "s1" } },
        attendees: [
          { email: "kate@example.com", responseStatus: "accepted" },
          { email: "sam@example.com", responseStatus: "declined" },
        ],
      },
    ],
    nextSyncToken: "tok2",
  };

  it("ignores a ping whose token doesn't match the org's channel", async () => {
    await handleNotification("chan1", "forged", "exists");
    expect(calls).toEqual([]);
  });

  it("confirms the accepted seat, leaves the declined one, and moves the sync token on", async () => {
    // The channel's real token, as Google echoes it, derived the way the
    // module derives it.
    const crypto = await import("crypto");
    const key = crypto.createHash("sha256").update("gcal-channel:test-secret").digest();
    const token = crypto.createHmac("sha256", key).update("org1").digest("base64url");

    routes = (method, url) => (method === "GET" && url.includes("syncToken=tok1") ? { body: eventPage } : undefined);
    m(prisma.assignment.findMany).mockResolvedValue([
      { id: "a1", role: "KEYS", status: "PENDING", userId: "u1", user: { email: "kate@example.com" } },
      { id: "a3", role: "BASS", status: "PENDING", userId: "u3", user: { email: "sam@example.com" } },
    ]);
    await handleNotification("chan1", token, "exists");

    expect(prisma.assignment.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, status: "PENDING" },
      data: { status: "CONFIRMED", swapReason: null },
    });
    expect(prisma.setHistoryEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.org.update).toHaveBeenCalledWith({
      where: { id: "org1" },
      data: { googleCalSyncToken: "tok2" },
    });
  });

  it("skips the handshake ping a new channel sends", async () => {
    const crypto = await import("crypto");
    const key = crypto.createHash("sha256").update("gcal-channel:test-secret").digest();
    const token = crypto.createHmac("sha256", key).update("org1").digest("base64url");
    await handleNotification("chan1", token, "sync");
    expect(calls).toEqual([]);
  });
});
