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
  importAuthorizeUrl,
  importFromCode,
  importWithRememberedAccess,
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

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.NEXTAUTH_SECRET = "s";
  eventUrls = [];
  calendarListCalls = 0;
  tokenBodies = [];
  refreshStatus = 200;
  m(prisma.availabilityRequest.findFirst).mockResolvedValue(REQUEST);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        const body = String(init?.body ?? "");
        tokenBodies.push(body);
        if (body.includes("grant_type=refresh_token")) {
          return refreshStatus === 200
            ? new Response(JSON.stringify({ access_token: "at2" }))
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
              { id: "primary", primary: true, accessRole: "owner" },
              { id: "work@example.com", accessRole: "writer" },
              { id: "holidays@group.v.calendar.google.com", accessRole: "reader" },
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

describe("importFromCode", () => {
  it("reads every page and replaces only the earlier imported blocks", async () => {
    const result = await importFromCode("u1", "req1", "code");
    expect(result).toEqual({ ok: true, blocks: 2 });
    // Primary's two pages plus the one other OWN calendar — the subscribed
    // holidays calendar is never fetched.
    expect(eventUrls).toHaveLength(3);
    expect(calendarListCalls).toBe(1);
    expect(eventUrls.some((u) => u.includes("work%40example.com"))).toBe(true);
    expect(eventUrls.some((u) => u.includes("holidays"))).toBe(false);
    // Never asks for titles.
    expect(decodeURIComponent(eventUrls[0])).not.toContain("summary");

    expect(prisma.unavailability.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", requestId: "req1", fromGoogle: true },
    });
    const rows = m(prisma.unavailability.createMany).mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ startDate: new Date(2026, 9, 5), startMinute: 540, endMinute: 600, fromGoogle: true, requestId: "req1", type: "SPECIFIC" }),
      expect.objectContaining({ startDate: new Date(2026, 9, 10), startMinute: 0, endMinute: 1440 }),
    ]);
  });

  it("remembers the permission so later imports skip Google's screen", async () => {
    await importFromCode("u1", "req1", "code");
    const saved = m(prisma.user.update).mock.calls[0][0];
    expect(saved.where).toEqual({ id: "u1" });
    expect(decryptSecret(saved.data.googleImportRefreshToken)).toBe("rt");
  });

  it("refuses a request the person isn't asked", async () => {
    m(prisma.availabilityRequest.findFirst).mockResolvedValue(null);
    const result = await importFromCode("u1", "req1", "code");
    expect(result.ok).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes nothing when calendar access wasn't granted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ access_token: "at", scope: "openid email" })))
    );
    const result = await importFromCode("u1", "req1", "code");
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/wasn't granted/) });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("importWithRememberedAccess", () => {
  it("imports with the remembered permission, no consent", async () => {
    m(prisma.user.findUnique).mockResolvedValue({ googleImportRefreshToken: encryptSecret("rt") });
    const result = await importWithRememberedAccess("u1", "req1");
    expect(result).toEqual({ ok: true, blocks: 2 });
    expect(tokenBodies[0]).toContain("refresh_token=rt");
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("re-asks consent for a token that predates the calendar-list scope", async () => {
    // Such a token can list nothing, so Google answers 403 — importing
    // `primary` alone would quietly be the old, wrong behaviour.
    m(prisma.user.findUnique).mockResolvedValue({ googleImportRefreshToken: encryptSecret("rt") });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("https://oauth2.googleapis.com/token")
          ? new Response(JSON.stringify({ access_token: "at2" }))
          : new Response('{"error":"insufficient scope"}', { status: 403 })
      )
    );
    const result = await importWithRememberedAccess("u1", "req1");
    expect(result).toMatchObject({ ok: false, needsConsent: true });
    // Nothing is written, so the blocks they already had survive.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("forgets a revoked permission and asks for consent again", async () => {
    m(prisma.user.findUnique).mockResolvedValue({ googleImportRefreshToken: encryptSecret("rt") });
    refreshStatus = 400;
    const result = await importWithRememberedAccess("u1", "req1");
    expect(result).toMatchObject({ ok: false, needsConsent: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { googleImportRefreshToken: null },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("asks for consent when nothing was ever granted", async () => {
    m(prisma.user.findUnique).mockResolvedValue({ googleImportRefreshToken: null });
    expect(await importWithRememberedAccess("u1", "req1")).toMatchObject({
      ok: false,
      needsConsent: true,
    });
  });
});
