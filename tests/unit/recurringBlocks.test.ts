// Unit tests for POST /api/availability's RECURRING branch — the overlap rules
// a weekly block goes through on its way in:
//   · an exact repeat creates nothing...
//   · ...unless days were freed out of it, in which case saying it again
//     RE-BOOKS them (the row keeps its place, minus its exceptions)
//   · a block a wider rule already says is skipped
//   · a block that says everything a narrower row does absorbs it
// prisma and the session are mocked; these are about the contract, not the db.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    unavailability: {
      findMany: vi.fn(),
      create: vi.fn(async (q: unknown) => q),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/org", () => ({ getMyOrgIds: vi.fn(async () => []) }));
vi.mock("@/lib/googleCalendar", () => ({
  isGoogleCalendarAppConfigured: () => false,
}));

import { NextRequest } from "next/server";
import { POST } from "@/app/api/availability/route";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;

// Tuesdays, 6am–5pm — the block in every case below.
const TUE = { dayOfWeek: 2, startMinute: 360, endMinute: 1020 };
// A stored row of that shape, open-ended unless the test says otherwise.
function row(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    dayOfWeek: 2,
    startMinute: 360,
    endMinute: 1020,
    startDate: null,
    endDate: null,
    exceptDates: [],
    ...over,
  };
}

function post(body: unknown) {
  return POST(
    new NextRequest("http://x/api/availability", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m(getSessionUser).mockResolvedValue({ id: "u1" });
});

describe("POST /api/availability — recurring overlaps", () => {
  it("creates a block nothing else covers", async () => {
    m(prisma.unavailability.findMany).mockResolvedValue([]);
    const res = await post({ type: "RECURRING", blocks: [TUE] });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ created: 1, rebooked: [] });
    expect(prisma.unavailability.deleteMany).not.toHaveBeenCalled();
  });

  it("re-books the days freed out of a block when it's added again", async () => {
    // The screenshot case: the rule is still there, with a hole in it.
    m(prisma.unavailability.findMany).mockResolvedValue([
      row({ exceptDates: ["2099-11-17"] }),
    ]);
    const res = await post({ type: "RECURRING", blocks: [TUE] });
    expect(res.status).toBe(200); // nothing created, but something happened
    expect(await res.json()).toMatchObject({
      created: 0,
      rebooked: ["2099-11-17"],
    });
    // The row stays put and simply loses its exceptions.
    expect(m(prisma.unavailability.updateMany).mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", id: { in: ["r1"] } },
      data: { exceptDates: [] },
    });
    expect(prisma.unavailability.createMany).not.toHaveBeenCalled();
  });

  it("re-books EVERY weekday in the batch, not just the first", async () => {
    // Tue + Wed ticked together, each rule carrying its own freed day.
    m(prisma.unavailability.findMany).mockResolvedValue([
      row({ id: "tue", exceptDates: ["2099-11-17"] }),
      row({ id: "wed", dayOfWeek: 3, exceptDates: ["2099-11-11"] }),
    ]);
    const res = await post({
      type: "RECURRING",
      blocks: [TUE, { ...TUE, dayOfWeek: 3 }],
    });
    expect(await res.json()).toMatchObject({
      created: 0,
      rebooked: ["2099-11-11", "2099-11-17"],
    });
    // Both rows lose their holes — a batch can't half-apply.
    expect(m(prisma.unavailability.updateMany).mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", id: { in: ["tue", "wed"] } },
      data: { exceptDates: [] },
    });
  });

  it("doesn't report days freed in the past as re-booked", async () => {
    m(prisma.unavailability.findMany).mockResolvedValue([
      row({ exceptDates: ["2000-01-04"] }),
    ]);
    const res = await post({ type: "RECURRING", blocks: [TUE] });
    // Nothing to say and nothing to create — that's the plain duplicate.
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: 0, rebooked: [] });
  });

  it("absorbs the narrower rows a new block already says", async () => {
    m(prisma.unavailability.findMany).mockResolvedValue([
      row({ id: "morning", startMinute: 360, endMinute: 720 }),
      row({ id: "bounded", startDate: new Date(2099, 0, 1), endDate: new Date(2099, 1, 1) }),
    ]);
    const res = await post({ type: "RECURRING", blocks: [TUE] });
    expect(await res.json()).toMatchObject({ created: 1, absorbed: 2 });
    expect(m(prisma.unavailability.deleteMany).mock.calls[0][0]).toMatchObject({
      where: { userId: "u1", id: { in: ["morning", "bounded"] } },
    });
  });

  it("skips a block a wider rule already says", async () => {
    m(prisma.unavailability.findMany).mockResolvedValue([
      row({ id: "allday", startMinute: 0, endMinute: 1440 }),
    ]);
    const res = await post({ type: "RECURRING", blocks: [TUE] });
    expect(await res.json()).toMatchObject({ created: 0, skipped: 1 });
    expect(prisma.unavailability.createMany).not.toHaveBeenCalled();
    expect(prisma.unavailability.deleteMany).not.toHaveBeenCalled();
  });
});
