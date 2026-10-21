// Unit tests for /api/google-calendar/calendars — the calendar picker. The
// list is the connecting admin's own account, so the one rule that matters is
// who may see it: the admin who connected, and nobody else.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: { org: { findUnique: vi.fn() } } }));
vi.mock("@/lib/org", () => ({ requireOrgAdminFor: vi.fn() }));
vi.mock("@/lib/googleCalendar", () => ({
  listCalendarsFor: vi.fn(async () => [{ id: "work", name: "Work", primary: false }]),
  selectCalendar: vi.fn(async () => ({ ok: true, changed: false })),
  syncUpcomingSets: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET, PUT } from "@/app/api/google-calendar/calendars/route";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminFor } from "@/lib/org";
import { listCalendarsFor, selectCalendar } from "@/lib/googleCalendar";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;
const url = "http://x/api/google-calendar/calendars?orgId=org1";

beforeEach(() => {
  vi.clearAllMocks();
  m(prisma.org.findUnique).mockResolvedValue({
    googleCalConnectedById: "kate",
    googleCalendarId: "cal1",
  });
});

describe("/api/google-calendar/calendars", () => {
  it("shows the connecting admin their calendars", async () => {
    m(requireOrgAdminFor).mockResolvedValue({ user: { id: "kate" } });
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      calendars: [{ id: "work", name: "Work", primary: false }],
      selectedId: "cal1",
    });
  });

  it("never lists them for another admin", async () => {
    m(requireOrgAdminFor).mockResolvedValue({ user: { id: "sam" } });
    expect((await GET(new NextRequest(url))).status).toBe(403);
    expect(listCalendarsFor).not.toHaveBeenCalled();
  });

  it("won't let another admin switch calendars either", async () => {
    m(requireOrgAdminFor).mockResolvedValue({ user: { id: "sam" } });
    const res = await PUT(
      new NextRequest(url, { method: "PUT", body: JSON.stringify({ calendarId: "work" }) })
    );
    expect(res.status).toBe(403);
    expect(selectCalendar).not.toHaveBeenCalled();
  });

  it("refuses non-admins and orgs nobody has connected", async () => {
    m(requireOrgAdminFor).mockResolvedValue(null);
    expect((await GET(new NextRequest(url))).status).toBe(403);
    m(requireOrgAdminFor).mockResolvedValue({ user: { id: "kate" } });
    m(prisma.org.findUnique).mockResolvedValue({ googleCalConnectedById: null, googleCalendarId: null });
    expect((await GET(new NextRequest(url))).status).toBe(403);
  });
});
