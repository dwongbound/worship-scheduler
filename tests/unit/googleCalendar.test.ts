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
  calendarEventOf,
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

describe("isGoogleCalendarAppConfigured", () => {
  it("is on with just the OAuth client — no extra flag", () => {
    expect(isGoogleCalendarAppConfigured()).toBe(true);
  });

  it("keeps everything off without the OAuth client", async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(isGoogleCalendarAppConfigured()).toBe(false);
    expect(await maintainCalendarWatches()).toEqual({ renewed: 0, orgs: 0 });
    expect(await calendarEventOf("s1")).toBeNull();
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
