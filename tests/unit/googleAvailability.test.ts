// Unit tests for lib/googleAvailability — "Import from Google Calendar" on
// /schedule. prisma and fetch are mocked: these check the consent URL, what's
// read from Google, and that only the person's earlier IMPORTED blocks for
// that request are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    availabilityRequest: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    unavailability: { deleteMany: vi.fn((a) => ({ op: "delete", ...a })), createMany: vi.fn((a) => ({ op: "create", ...a })) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("@/lib/org", () => ({ getMyOrgIds: vi.fn(async () => ["org1"]) }));

import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import {
  CALENDAR_LIST_SCOPE,
  importAuthorizeUrl,
  listImportCalendars,
  previewImport,
  rememberAccessFromCode,
  runImportFor,
} from "@/lib/googleAvailability";
import { verifyImportState, verifyState } from "@/lib/googleCalendar";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;

const REQUEST = {
  id: "req1",
  startDate: new Date(2026, 9, 1),
  endDate: new Date(2026, 9, 31),
};

let calendarListCalls: number;
let eventUrls: string[];
let tokenBodies: string[];
let refreshStatus: number;
// What Google says a refresh covers; undefined leaves the field off.
let refreshScope: string | undefined;

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.NEXTAUTH_SECRET = "s";
  eventUrls = [];
  calendarListCalls = 0;
  tokenBodies = [];
  refreshStatus = 200;
  refreshScope = undefined;
  m(prisma.availabilityRequest.findFirst).mockResolvedValue(REQUEST);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const body = String(init?.body ?? "");
        tokenBodies.push(body);
        if (body.includes("grant_type=refresh_token")) {
          return refreshStatus === 200
            ? new Response(JSON.stringify({ access_token: "at2", scope: refreshScope }))
            : new Response('{"error":"invalid_grant"}', { status: refreshStatus });
        }
        return new Response(
          JSON.stringify({
            access_token: "at",
            refresh_token: "rt",
            scope: "openid email https://www.googleapis.com/auth/calendar.events.readonly",
          })
        );
      }
      // The calendar LIST comes first: two own calendars and a subscription
      // the import must leave alone.
      if (url.startsWith("https://www.googleapis.com/calendar/v3/users/me/calendarList")) {
        calendarListCalls++;
        return new Response(
          JSON.stringify({
            items: [
              { id: "primary", primary: true, accessRole: "owner", summary: "me@example.com" },
              { id: "work@example.com", accessRole: "writer", summary: "Work" },
              {
                id: "holidays@group.v.calendar.google.com",
                accessRole: "reader",
                summary: "Holidays in United States",
              },
            ],
          })
        );
      }
      eventUrls.push(url);
      // Only the FIRST calendar pages, so the page-token walk is still covered
      // without every calendar repeating it.
      const isPrimary = url.includes("/calendars/primary/");
      const page2 = url.includes("pageToken=p2");
      if (!isPrimary) return new Response(JSON.stringify({ items: [] }));
      return new Response(
        JSON.stringify(
          page2
            ? { items: [{ start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }] }
            : {
                items: [
                  { start: { dateTime: "2026-10-05T09:00:00-07:00" }, end: { dateTime: "2026-10-05T10:00:00-07:00" } },
                  {
                    start: { dateTime: "2026-10-06T09:00:00-07:00" },
                    end: { dateTime: "2026-10-06T10:00:00-07:00" },
                    transparency: "transparent",
                  },
                ],
                nextPageToken: "p2",
              }
        )
      );
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("importAuthorizeUrl", () => {
  it("asks once for read-only events, with a refresh token to remember", () => {
    const url = new URL(importAuthorizeUrl("u1", "req1", "me@example.com"));
    expect(url.searchParams.get("scope")).toContain("calendar.events.readonly");
    // Without the list scope the import can only ever see `primary`.
    expect(url.searchParams.get("scope")).toContain("calendar.calendarlist.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("login_hint")).toBe("me@example.com");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/google-calendar\/callback$/);
  });
  it("signs a state only the import flow accepts", () => {
    const state = new URL(importAuthorizeUrl("u1", "req1", null)).searchParams.get("state")!;
    expect(verifyImportState(state)).toEqual({ userId: "u1", requestId: "req1" });
    expect(verifyState(state)).toBeNull();
  });
});

// A remembered permission, which is what every call but the consent trip
// starts from.
const remembered = () =>
  m(prisma.user.findUnique).mockResolvedValue({
    googleImportRefreshToken: encryptSecret("rt"),
  });

describe("rememberAccessFromCode", () => {
  it("keeps the refresh token and imports nothing", async () => {
    expect(await rememberAccessFromCode("u1", "code")).toEqual({ ok: true });
    const saved = m(prisma.user.update).mock.calls[0][0];
    expect(saved.where).toEqual({ id: "u1" });
    expect(decryptSecret(saved.data.googleImportRefreshToken)).toBe("rt");
    // The consent trip's only job is the permission: the person lands back in
    // the modal and picks their calendars there.
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(eventUrls).toHaveLength(0);
  });

  it("keeps nothing when calendar access wasn't granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "at", scope: "openid email" })))
    );
    expect(await rememberAccessFromCode("u1", "code")).toEqual({
      ok: false,
      error: expect.stringMatching(/wasn't granted/),
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

// The /profile picker asks only for the calendar list, which Google doesn't
// count as sensitive, so members never meet the "unverified app" screen there.
describe("the /profile picker's narrower permission", () => {
  const LIST_ONLY = `openid email ${CALENDAR_LIST_SCOPE}`;

  it("asks Google for the calendar list and not the events", () => {
    const scope = new URL(importAuthorizeUrl("u1", null, null)).searchParams.get("scope")!;
    expect(scope).toContain("calendar.calendarlist.readonly");
    expect(scope).not.toContain("calendar.events");
    // ...while keeping what an import granted earlier.
    expect(
      new URL(importAuthorizeUrl("u1", null, null)).searchParams.get("include_granted_scopes")
    ).toBe("true");
  });

  it("lists calendars on a list-only permission", async () => {
    remembered();
    refreshScope = LIST_ONLY;
    expect(await listImportCalendars("u1", CALENDAR_LIST_SCOPE)).toMatchObject({ ok: true });
  });

  it("sends an import on a list-only permission back to Google, keeping the token", async () => {
    remembered();
    refreshScope = LIST_ONLY;
    expect(await listImportCalendars("u1")).toMatchObject({ ok: false, needsConsent: true });
    expect(await previewImport("u1", "req1", ["primary"])).toMatchObject({
      ok: false,
      needsConsent: true,
    });
    expect(await runImportFor("u1", "req1", ["primary"])).toMatchObject({
      ok: false,
      needsConsent: true,
    });
    expect(calendarListCalls).toBe(0);
    expect(eventUrls).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // The picker still uses it.
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("lets an import permission serve the picker too", async () => {
    remembered();
    refreshScope = `openid email https://www.googleapis.com/auth/calendar.events.readonly ${CALENDAR_LIST_SCOPE}`;
    expect(await listImportCalendars("u1", CALENDAR_LIST_SCOPE)).toMatchObject({ ok: true });
  });
});

describe("listImportCalendars", () => {
  it("lists the person's own calendars by name, primary first", async () => {
    remembered();
    const result = await listImportCalendars("u1");
    expect(result).toEqual({
      ok: true,
      calendars: [
        { id: "primary", name: "me@example.com", primary: true },
        { id: "work@example.com", name: "Work", primary: false },
      ],
    });
    // A subscription is not this person's commitment, and a holidays calendar
    // would block whole days for everyone.
    expect(JSON.stringify(result)).not.toContain("Holidays");
    expect(calendarListCalls).toBe(1);
    expect(eventUrls).toHaveLength(0);
  });

  it("asks for consent when nothing was ever granted", async () => {
    m(prisma.user.findUnique).mockResolvedValue({ googleImportRefreshToken: null });
    expect(await listImportCalendars("u1")).toMatchObject({ ok: false, needsConsent: true });
  });

  it("re-asks consent for a token that predates the calendar-list scope", async () => {
    // Such a token can list nothing, so Google answers 403. Re-asking is what
    // turns it into a token that can see every calendar.
    remembered();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://oauth2.googleapis.com/token")
          ? new Response(JSON.stringify({ access_token: "at2" }))
          : new Response('{"error":"insufficient scope"}', { status: 403 })
      )
    );
    expect(await listImportCalendars("u1")).toMatchObject({ ok: false, needsConsent: true });
  });

  it("forgets a revoked permission and asks for consent again", async () => {
    remembered();
    refreshStatus = 400;
    expect(await listImportCalendars("u1")).toMatchObject({ ok: false, needsConsent: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { googleImportRefreshToken: null },
    });
  });
});

describe("previewImport", () => {
  it("reads only the chosen calendars and writes nothing", async () => {
    remembered();
    const result = await previewImport("u1", "req1", ["primary"]);
    expect(result).toEqual({
      ok: true,
      windows: [
        { ymd: "2026-10-05", startMinute: 540, endMinute: 600 },
        { ymd: "2026-10-10", startMinute: 0, endMinute: 1440 },
      ],
    });
    // One calendar, its two pages — and never the one that wasn't picked.
    expect(eventUrls).toHaveLength(2);
    expect(eventUrls.some((u) => u.includes("work%40example.com"))).toBe(false);
    // Never asks for titles.
    expect(decodeURIComponent(eventUrls[0])).not.toContain("summary");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("merges overlapping events from different calendars into one window", async () => {
    remembered();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://oauth2.googleapis.com/token")) {
          return new Response(JSON.stringify({ access_token: "at2" }));
        }
        // 4–6pm on one calendar, 5–7pm on the other: one 4–7pm block.
        const hours = url.includes("work%40example.com") ? [16, 18] : [17, 19];
        return new Response(
          JSON.stringify({
            items: [
              {
                start: { dateTime: `2026-10-07T${hours[0]}:00:00-07:00` },
                end: { dateTime: `2026-10-07T${hours[1]}:00:00-07:00` },
              },
            ],
          })
        );
      })
    );
    const result = await previewImport("u1", "req1", ["primary", "work@example.com"]);
    expect(result).toEqual({
      ok: true,
      windows: [{ ymd: "2026-10-07", startMinute: 16 * 60, endMinute: 19 * 60 }],
    });
  });

  it("reads nothing at all when no calendar is picked", async () => {
    remembered();
    expect(await previewImport("u1", "req1", [])).toEqual({ ok: true, windows: [] });
    expect(eventUrls).toHaveLength(0);
  });

  it("refuses a request the person isn't asked", async () => {
    m(prisma.availabilityRequest.findFirst).mockResolvedValue(null);
    expect(await previewImport("u1", "req1", ["primary"])).toMatchObject({ ok: false });
    expect(eventUrls).toHaveLength(0);
  });
});

describe("runImportFor", () => {
  it("replaces only the earlier imported blocks for that request", async () => {
    remembered();
    const result = await runImportFor("u1", "req1", ["primary", "work@example.com"]);
    expect(result).toEqual({ ok: true, blocks: 2 });
    // Both picked calendars, primary's two pages among them.
    expect(eventUrls).toHaveLength(3);
    expect(tokenBodies[0]).toContain("refresh_token=rt");

    expect(prisma.unavailability.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", requestId: "req1", fromGoogle: true },
    });
    const rows = m(prisma.unavailability.createMany).mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        startDate: new Date(2026, 9, 5),
        startMinute: 540,
        endMinute: 600,
        fromGoogle: true,
        requestId: "req1",
        type: "SPECIFIC",
      }),
      expect.objectContaining({ startDate: new Date(2026, 9, 10), startMinute: 0, endMinute: 1440 }),
    ]);
  });

  it("writes what the preview showed, so importing twice leaves the same rows", async () => {
    remembered();
    const previewed = await previewImport("u1", "req1", ["primary", "work@example.com"]);
    const first = await runImportFor("u1", "req1", ["primary", "work@example.com"]);
    const firstRows = m(prisma.unavailability.createMany).mock.calls[0][0].data;
    m(prisma.unavailability.createMany).mockClear();
    const second = await runImportFor("u1", "req1", ["primary", "work@example.com"]);
    const secondRows = m(prisma.unavailability.createMany).mock.calls[0][0].data;
    expect(second).toEqual(first);
    expect(secondRows).toEqual(firstRows);
    // And the preview was the same answer, not an estimate of it.
    expect(previewed).toMatchObject({ ok: true });
    expect(firstRows).toHaveLength(
      (previewed as { ok: true; windows: unknown[] }).windows.length
    );
  });

  it("clears the import when no calendar is picked, without reading Google", async () => {
    remembered();
    expect(await runImportFor("u1", "req1", [])).toEqual({ ok: true, blocks: 0 });
    expect(eventUrls).toHaveLength(0);
    expect(m(prisma.unavailability.createMany).mock.calls[0][0].data).toEqual([]);
  });

  it("asks for consent rather than wiping the blocks when access is gone", async () => {
    remembered();
    refreshStatus = 400;
    expect(await runImportFor("u1", "req1", ["primary"])).toMatchObject({
      ok: false,
      needsConsent: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a request the person isn't asked", async () => {
    m(prisma.availabilityRequest.findFirst).mockResolvedValue(null);
    expect(await runImportFor("u1", "req1", ["primary"])).toMatchObject({ ok: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
