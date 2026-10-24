// Unit tests for PUT /api/admin/sets/roster — the calendar Preview Mode's batch
// save — and the pure parsing half of lib/rosterDiff.ts.
//
// prisma, the admin gate, the MD helpers and Slack are mocked: the cases are
// about the batch's contract — every set validated before ANY write, all the
// writes in one transaction, one org per batch, and an MD the new roster
// can't support reported rather than failing the save.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    set: { findMany: vi.fn(), update: vi.fn() },
    assignment: {
      findMany: vi.fn(),
      delete: vi.fn((q) => ({ op: "delete", q })),
      update: vi.fn((q) => ({ op: "update", q })),
      create: vi.fn((q) => ({ op: "create", q })),
    },
    setHistoryEvent: { create: vi.fn((q) => ({ op: "history", q })) },
    orgMembership: { findMany: vi.fn() },
    setGuestTeam: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/org", () => ({ requireOrgAdminFor: vi.fn() }));
vi.mock("@/lib/setMd", () => ({
  clearStaleMD: vi.fn(),
  promoteMDIfEmpty: vi.fn(),
  loadForMD: vi.fn(),
}));
vi.mock("@/lib/slack", () => ({
  notifySetChange: vi.fn(),
  notifyRosterChanges: vi.fn(),
}));
vi.mock("@/lib/teamRoleStore", () => ({
  getTeamCatalog: vi.fn(async () => [
    { key: "KEYS", label: "Keys", defaultCount: 1, adminOnly: false, order: 0 },
    { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 1 },
  ]),
  getTeamCatalogs: vi.fn(async () => new Map()),
}));

import { NextRequest } from "next/server";
import { PUT } from "@/app/api/admin/sets/roster/route";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminFor } from "@/lib/org";
import { loadForMD } from "@/lib/setMd";
import { notifyRosterChanges, notifySetChange } from "@/lib/slack";
import { isEmptyOps, parseRosterOps } from "@/lib/rosterDiff";

type Mock = ReturnType<typeof vi.fn>;
const m = (f: unknown) => f as Mock;

function put(body: unknown) {
  return PUT(
    new NextRequest("http://x/api/admin/sets/roster", {
      method: "PUT",
      body: JSON.stringify(body),
    })
  );
}

// The set rows the route's findMany can see, filtered like the real query.
function setsInDb(rows: { id: string; orgId: string; teamId: string }[]) {
  m(prisma.set.findMany).mockImplementation(async ({ where }) =>
    rows.filter((r) => where.id.in.includes(r.id))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  setsInDb([
    { id: "s1", orgId: "org1", teamId: "t1" },
    { id: "s2", orgId: "org1", teamId: "t1" },
  ]);
  m(requireOrgAdminFor).mockResolvedValue({ user: { id: "admin" } });
  // Seat a1 (Carol, keys) lives on s1; a2 (Bob, drums) on s2. The prepare step
  // reads a set's WHOLE roster (`{ setId }`, no id filter) — it has to see the
  // seats a diff doesn't mention, which is where the duplicates came from.
  m(prisma.assignment.findMany).mockImplementation(async ({ where }) =>
    [
      { id: "a1", setId: "s1", role: "KEYS", userId: "u1", user: { name: "Carol" } },
      { id: "a2", setId: "s2", role: "DRUMS", userId: "u2", user: { name: "Bob" } },
    ].filter(
      (a) =>
        a.setId === where.setId && (!where.id || where.id.in.includes(a.id))
    )
  );
  m(prisma.orgMembership.findMany).mockImplementation(async ({ where }) =>
    where.userId.in.map((userId: string) => ({ userId, user: { name: userId } }))
  );
  m(prisma.setGuestTeam.findMany).mockResolvedValue([]);
  m(prisma.$transaction).mockResolvedValue([]);
  m(loadForMD).mockResolvedValue({ roster: [] });
});

describe("PUT /api/admin/sets/roster", () => {
  it("applies every set's diff in ONE transaction", async () => {
    const res = await put({
      sets: [
        { setId: "s1", removed: ["a1"] },
        { setId: "s2", reassigned: [{ id: "a2", userId: "u9" }] },
      ],
    });
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // A delete + its history row, an update + its history row.
    expect(m(prisma.$transaction).mock.calls[0][0]).toHaveLength(4);
    expect(await res.json()).toMatchObject({ ok: true, applied: 2, sets: 2 });
    // One grouped notice per set.
    expect(notifySetChange).toHaveBeenCalledTimes(2);
    // ...but ONE DM batch for the whole save, holding every set's changes.
    expect(notifyRosterChanges).toHaveBeenCalledTimes(1);
    expect(m(notifyRosterChanges).mock.calls[0]).toEqual([
      "org1",
      [
        { userId: "u1", kind: "removed", role: "KEYS", setId: "s1", catalog: expect.any(Array) },
        { userId: "u2", kind: "removed", role: "DRUMS", setId: "s2", catalog: expect.any(Array) },
        { userId: "u9", kind: "added", role: "DRUMS", setId: "s2", catalog: expect.any(Array) },
      ],
    ]);
  });

  it("saves when a guest-team seat's holder is seated again in that role", async () => {
    // The 400 this fixes. Preview Mode leaves borrowed seats off the card, so
    // it couldn't see that Carol already held keys on s1 as a guest — Auto
    // schedule proposed her for keys, and the db's unique [set, person, role]
    // refused the whole batch.
    m(prisma.assignment.findMany).mockImplementation(async ({ where }) =>
      [
        { id: "g1", setId: "s1", role: "KEYS", userId: "u1", user: { name: "Carol" } },
      ].filter(
        (a) =>
          a.setId === where.setId && (!where.id || where.id.in.includes(a.id))
      )
    );
    const res = await put({
      sets: [{ setId: "s1", added: [{ role: "KEYS", userId: "u1" }] }],
    });
    expect(res.status).toBe(200);
    // Her existing seat is left exactly as it is — status, confirmation and
    // any cover request on it intact — and nothing is inserted.
    expect(prisma.assignment.create).not.toHaveBeenCalled();
    expect(prisma.assignment.delete).not.toHaveBeenCalled();
    expect(m(prisma.$transaction).mock.calls[0][0]).toHaveLength(0);
    // Nobody is told about a change that didn't happen.
    expect(m(notifyRosterChanges).mock.calls[0][1]).toEqual([]);
    expect(notifySetChange).not.toHaveBeenCalled();
  });

  it("saves a two-person trade inside one role", async () => {
    // Both seats keep their role, so the save is two reassignments — and the
    // writes are ordered so neither moment holds one person in VOCALS twice.
    m(prisma.assignment.findMany).mockImplementation(async ({ where }) =>
      [
        { id: "v1", setId: "s1", role: "VOCALS", userId: "u1", user: { name: "Carol" } },
        { id: "v2", setId: "s1", role: "VOCALS", userId: "u2", user: { name: "Bob" } },
      ].filter(
        (a) =>
          a.setId === where.setId && (!where.id || where.id.in.includes(a.id))
      )
    );
    const res = await put({
      sets: [
        {
          setId: "s1",
          reassigned: [
            { id: "v1", userId: "u2" },
            { id: "v2", userId: "u1" },
          ],
        },
      ],
    });
    expect(res.status).toBe(200);
    expect(prisma.assignment.update).toHaveBeenCalledTimes(2);
  });

  it("writes nothing when any set in the batch is stale", async () => {
    const res = await put({
      sets: [
        { setId: "s1", removed: ["a1"] },
        // a1 isn't on s2 — someone else changed it.
        { setId: "s2", removed: ["a1"] },
      ],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).setId).toBe("s2");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a batch that spans orgs", async () => {
    setsInDb([
      { id: "s1", orgId: "org1", teamId: "t1" },
      { id: "s2", orgId: "org2", teamId: "t1" },
    ]);
    const res = await put({
      sets: [
        { setId: "s1", removed: ["a1"] },
        { setId: "s2", removed: ["a2"] },
      ],
    });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("is admin-only", async () => {
    m(requireOrgAdminFor).mockResolvedValue(null);
    const res = await put({ sets: [{ setId: "s1", removed: ["a1"] }] });
    expect(res.status).toBe(403);
  });

  it("refuses a role the team doesn't have", async () => {
    const res = await put({
      sets: [{ setId: "s1", added: [{ role: "THEREMIN", userId: "u3" }] }],
    });
    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("applies MD picks after the roster, reporting ones it can't take", async () => {
    // s1: u1 is an eligible MD; s2: nobody on the roster can lead.
    m(loadForMD).mockImplementation(async (setId: string) => ({
      roster:
        setId === "s1"
          ? [{ userId: "u1", role: "KEYS", isMD: true, pendingFrom: null }]
          : [],
    }));
    const res = await put({
      sets: [
        { setId: "s1", mdUserId: "u1" },
        { setId: "s2", mdUserId: "u2" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mdApplied: 1, mdRejected: ["s2"] });
    expect(prisma.set.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { mdUserId: "u1" },
    });
    // No roster ops → no transaction.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an empty or duplicated batch", async () => {
    expect((await put({ sets: [] })).status).toBe(400);
    expect(
      (await put({ sets: [{ setId: "s1" }, { setId: "s1" }] })).status
    ).toBe(400);
  });
});

describe("parseRosterOps", () => {
  it("keeps well-formed items and drops the rest", () => {
    expect(
      parseRosterOps({
        removed: ["a1", 7],
        reassigned: [{ id: "a2", userId: "u2" }, { id: "a3" }],
        added: [
          { role: "KEYS", userId: "u3" },
          { role: "KEYS", userId: "u4", guestTeamId: 5 },
        ],
      })
    ).toEqual({
      removed: ["a1"],
      reassigned: [{ id: "a2", userId: "u2" }],
      added: [{ role: "KEYS", userId: "u3" }],
    });
  });

  it("reads a missing body as no ops", () => {
    expect(isEmptyOps(parseRosterOps(null))).toBe(true);
  });
});
