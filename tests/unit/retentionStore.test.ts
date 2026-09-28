// The sweep itself: which rows it asks the database to delete, which orgs it
// visits, and what it stamps afterwards.
//
// prisma is mocked, so these are still pure unit tests — what's being checked
// is the WHERE clauses and the control flow, which is where a retention bug
// would be silently destructive. (Whether a cascade fires is the schema's job
// and postgres's; tests/e2e covers the settings flow end to end.)
import { beforeEach, describe, expect, it, vi } from "vitest";

const set = { deleteMany: vi.fn(), count: vi.fn() };
const availabilityRequest = { deleteMany: vi.fn(), count: vi.fn() };
const assignment = { count: vi.fn() };
const setHistoryEvent = { count: vi.fn() };
const availabilityResponse = { count: vi.fn() };
const org = { findMany: vi.fn(), update: vi.fn() };
// $transaction takes the array of prepared operations and runs them together;
// the mock just resolves them, which is enough to see what was handed over.
const $transaction = vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    set,
    availabilityRequest,
    assignment,
    setHistoryEvent,
    availabilityResponse,
    org,
    $transaction,
  },
}));

const { previewOrgPrune, pruneOrg, runDuePrunes } = await import(
  "@/lib/retentionStore"
);
const { retentionCutoff } = await import("@/lib/retention");

const NOW = new Date(2026, 8, 28); // 28 Sep 2026
const YEAR_AGO = retentionCutoff(12, NOW); // 28 Sep 2025

beforeEach(() => {
  vi.clearAllMocks();
  set.deleteMany.mockResolvedValue({ count: 0 });
  availabilityRequest.deleteMany.mockResolvedValue({ count: 0 });
  set.count.mockResolvedValue(0);
  availabilityRequest.count.mockResolvedValue(0);
  assignment.count.mockResolvedValue(0);
  setHistoryEvent.count.mockResolvedValue(0);
  availabilityResponse.count.mockResolvedValue(0);
  org.findMany.mockResolvedValue([]);
  org.update.mockResolvedValue({});
});

describe("pruneOrg", () => {
  it("deletes only this org's rows, and only from before the cutoff", async () => {
    await pruneOrg("org-1", 12, NOW);

    expect(set.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", startsAt: { lt: YEAR_AGO } },
    });
    expect(availabilityRequest.deleteMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", endDate: { lt: YEAR_AGO } },
    });
  });

  it("scopes a set by when it STARTED and a request by when it ENDED", async () => {
    // A request that is still open (endDate in the future) must survive even
    // when it was created years ago — the dates mean different things.
    await pruneOrg("org-1", 3, NOW);
    const setWhere = set.deleteMany.mock.calls[0][0].where;
    const requestWhere = availabilityRequest.deleteMany.mock.calls[0][0].where;
    expect(Object.keys(setWhere)).toEqual(["orgId", "startsAt"]);
    expect(Object.keys(requestWhere)).toEqual(["orgId", "endDate"]);
  });

  it("applies a shorter window as a nearer cutoff", async () => {
    await pruneOrg("org-1", 3, NOW);
    expect(set.deleteMany.mock.calls[0][0].where.startsAt.lt).toEqual(
      retentionCutoff(3, NOW)
    );
  });

  it("runs both deletes in one transaction", async () => {
    await pruneOrg("org-1", 12, NOW);
    expect($transaction).toHaveBeenCalledTimes(1);
    expect($transaction.mock.calls[0][0]).toHaveLength(2);
  });

  it("reports what it deleted", async () => {
    set.deleteMany.mockResolvedValue({ count: 142 });
    availabilityRequest.deleteMany.mockResolvedValue({ count: 3 });
    expect(await pruneOrg("org-1", 12, NOW)).toEqual({ sets: 142, requests: 3 });
  });
});

describe("previewOrgPrune", () => {
  it("counts against the same cutoff the sweep would use, deleting nothing", async () => {
    set.count.mockResolvedValue(142);
    assignment.count.mockResolvedValue(1204);
    setHistoryEvent.count.mockResolvedValue(87);
    availabilityRequest.count.mockResolvedValue(3);
    availabilityResponse.count.mockResolvedValue(24);

    const preview = await previewOrgPrune("org-1", 12, NOW);

    expect(preview).toEqual({
      cutoff: YEAR_AGO.toISOString(),
      sets: 142,
      assignments: 1204,
      historyEvents: 87,
      requests: 3,
      responses: 24,
    });
    expect(set.deleteMany).not.toHaveBeenCalled();
    expect(availabilityRequest.deleteMany).not.toHaveBeenCalled();
  });

  it("counts cascaded rows through their parent's own filter", async () => {
    await previewOrgPrune("org-1", 12, NOW);
    // Roster entries and log lines aren't org-scoped themselves — they're
    // reachable only through the set that owns them.
    expect(assignment.count).toHaveBeenCalledWith({
      where: { set: { orgId: "org-1", startsAt: { lt: YEAR_AGO } } },
    });
    expect(setHistoryEvent.count).toHaveBeenCalledWith({
      where: { set: { orgId: "org-1", startsAt: { lt: YEAR_AGO } } },
    });
    expect(availabilityResponse.count).toHaveBeenCalledWith({
      where: { request: { orgId: "org-1", endDate: { lt: YEAR_AGO } } },
    });
  });
});

describe("runDuePrunes", () => {
  const day = 24 * 60 * 60 * 1000;

  it("sweeps an org that has never been swept", async () => {
    org.findMany.mockResolvedValue([
      { id: "org-1", retentionMonths: 12, lastPrunedAt: null },
    ]);
    set.deleteMany.mockResolvedValue({ count: 5 });

    const result = await runDuePrunes(NOW);

    expect(result).toEqual({ swept: 1, sets: 5, requests: 0 });
    expect(org.update).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { lastPrunedAt: NOW },
    });
  });

  it("leaves an org swept this week alone entirely", async () => {
    org.findMany.mockResolvedValue([
      {
        id: "org-1",
        retentionMonths: 12,
        lastPrunedAt: new Date(NOW.getTime() - day),
      },
    ]);

    expect(await runDuePrunes(NOW)).toEqual({ swept: 0, sets: 0, requests: 0 });
    expect(set.deleteMany).not.toHaveBeenCalled();
    expect(org.update).not.toHaveBeenCalled();
  });

  it("stamps an org even when nothing was old enough to delete", async () => {
    org.findMany.mockResolvedValue([
      { id: "quiet", retentionMonths: 48, lastPrunedAt: null },
    ]);

    const result = await runDuePrunes(NOW);

    expect(result.swept).toBe(1);
    expect(result.sets).toBe(0);
    // Without the stamp, a workspace with nothing to delete would be re-counted
    // every single night.
    expect(org.update).toHaveBeenCalledTimes(1);
  });

  it("honours each org's OWN window, and totals what it deleted", async () => {
    org.findMany.mockResolvedValue([
      { id: "long", retentionMonths: 48, lastPrunedAt: null },
      { id: "short", retentionMonths: 3, lastPrunedAt: null },
    ]);
    set.deleteMany.mockResolvedValue({ count: 2 });
    availabilityRequest.deleteMany.mockResolvedValue({ count: 1 });

    const result = await runDuePrunes(NOW);

    expect(result).toEqual({ swept: 2, sets: 4, requests: 2 });
    const cutoffs = set.deleteMany.mock.calls.map(
      (c) => c[0].where.startsAt.lt
    );
    expect(cutoffs).toEqual([retentionCutoff(48, NOW), retentionCutoff(3, NOW)]);
  });

  it("sweeps only the orgs that are due, out of a mixed list", async () => {
    org.findMany.mockResolvedValue([
      { id: "due", retentionMonths: 12, lastPrunedAt: null },
      {
        id: "fresh",
        retentionMonths: 12,
        lastPrunedAt: new Date(NOW.getTime() - 2 * day),
      },
      {
        id: "stale",
        retentionMonths: 12,
        lastPrunedAt: new Date(NOW.getTime() - 30 * day),
      },
    ]);

    const result = await runDuePrunes(NOW);

    expect(result.swept).toBe(2);
    const sweptIds = org.update.mock.calls.map((c) => c[0].where.id);
    expect(sweptIds).toEqual(["due", "stale"]);
  });
});
