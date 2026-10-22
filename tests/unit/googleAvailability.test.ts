// Unit tests for lib/googleAvailability — "Import from Google Calendar" on
// /schedule. prisma and fetch are mocked: these check the consent URL, what's
// read from Google, and that only the person's earlier IMPORTED blocks for
// that request are replaced.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    availabilityRequest: { findFirst: vi.fn() },
    unavailability: { deleteMany: vi.fn((a) => ({ op: "delete", ...a })), createMany: vi.fn((a) => ({ op: "create", ...a })) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("@/lib/org", () => ({ getMyOrgIds: vi.fn(async () => ["org1"]) }));

import { prisma } from "@/lib/prisma";
import { importAuthorizeUrl, importFromCode } from "@/lib/googleAvailability";
import { verifyImportState, verifyState } from "@/lib/googleCalendar";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;

const REQUEST = {
  id: "req1",
  startDate: new Date(2026, 9, 1),
  endDate: new Date(2026, 9, 31),
};

let eventUrls: string[];

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = "cid";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  process.env.NEXTAUTH_SECRET = "s";
  eventUrls = [];
  m(prisma.availabilityRequest.findFirst).mockResolvedValue(REQUEST);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(
          JSON.stringify({
            access_token: "at",
            scope: "openid email https://www.googleapis.com/auth/calendar.events.readonly",
          })
        );
      }
      eventUrls.push(url);
      const page2 = url.includes("pageToken=p2");
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
  it("asks for read-only events, online, for the person's own account", () => {
    const url = new URL(importAuthorizeUrl("u1", "req1", "me@example.com"));
    expect(url.searchParams.get("scope")).toContain("calendar.events.readonly");
    expect(url.searchParams.get("access_type")).toBe("online");
    expect(url.searchParams.get("login_hint")).toBe("me@example.com");
    expect(url.searchParams.get("redirect_uri")).toMatch(/\/api\/google-calendar\/callback$/);
    // No forced prompt: once granted, Google bounces straight back.
    expect(url.searchParams.get("prompt")).toBeNull();
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
    expect(eventUrls).toHaveLength(2);
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
