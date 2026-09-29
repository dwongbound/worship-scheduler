// Unit tests for lib/slack.syncOrgSlackIds — one batch of the admin-triggered
// "Sync team members" sweep. This replaced the install-time auto-populate, so
// the things that used to be silent (no email, an email Slack doesn't know, a
// batch boundary) are what the counts here have to get right.
//
// prisma is mocked (it reads the org's credential + a window of memberships and
// writes ids back); fetch is mocked so nothing hits Slack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    org: { findUnique: vi.fn() },
    orgMembership: { findMany: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

import { syncOrgSlackIds } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

const orgFindUnique = prisma.org.findUnique as unknown as ReturnType<typeof vi.fn>;
const membershipFindMany = prisma.orgMembership
  .findMany as unknown as ReturnType<typeof vi.fn>;
const membershipUpdate = prisma.orgMembership
  .update as unknown as ReturnType<typeof vi.fn>;
const membershipCount = prisma.orgMembership
  .count as unknown as ReturnType<typeof vi.fn>;

let fetchMock: ReturnType<typeof vi.fn>;

// count() is called twice per batch — the org's size, then how many hold an id.
// Order is fixed by the implementation, so feed them in that order.
function counts(total: number, synced: number) {
  membershipCount.mockResolvedValueOnce(total).mockResolvedValueOnce(synced);
}

function member(id: string, email: string | null) {
  return { id, user: { email } };
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
  delete process.env.SLACK_DRY_RUN;
  orgFindUnique.mockResolvedValue({ slackBotToken: encryptSecret("xoxb-test") });
  membershipUpdate.mockResolvedValue({});
  fetchMock = vi
    .fn()
    .mockResolvedValue({ json: async () => ({ ok: true, user: { id: "U9" } }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("syncOrgSlackIds", () => {
  it("looks each person up by email and caches the member id", async () => {
    counts(2, 2);
    membershipFindMany.mockResolvedValue([
      member("m1", "sam@example.com"),
      member("m2", "kim@example.com"),
    ]);

    const batch = await syncOrgSlackIds("org1", 0, 10);

    expect(fetchMock.mock.calls[0][0]).toContain("users.lookupByEmail");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      email: "sam@example.com",
    });
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { slackUserId: "U9" },
    });
    expect(batch).toEqual({
      total: 2,
      processed: 2,
      matched: 2,
      synced: 2,
      done: true,
    });
  });

  it("re-checks people who already have an id, so a new workspace replaces them", async () => {
    // The window is the org's people, full stop — no `slackUserId: null` filter,
    // which is what the old install-time sweep had and why reconnecting to a
    // different workspace left everyone on their old (wrong) ids.
    counts(1, 1);
    membershipFindMany.mockResolvedValue([member("m1", "sam@example.com")]);

    await syncOrgSlackIds("org1", 0, 10);

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { orgId: "org1" } })
    );
  });

  it("counts a person with no email as processed but never looks them up", async () => {
    counts(2, 1);
    membershipFindMany.mockResolvedValue([
      member("m1", "sam@example.com"),
      member("m2", null),
    ]);

    const batch = await syncOrgSlackIds("org1", 0, 10);

    // One lookup, not two — but the bar still walked past both people.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(batch).toMatchObject({ processed: 2, matched: 1, synced: 1 });
  });

  it("doesn't count an email the workspace doesn't know", async () => {
    counts(1, 0);
    membershipFindMany.mockResolvedValue([member("m1", "ghost@example.com")]);
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: false, error: "users_not_found" }),
    });

    const batch = await syncOrgSlackIds("org1", 0, 10);

    // A miss leaves the row alone — it never clears an id somebody set by hand.
    expect(membershipUpdate).not.toHaveBeenCalled();
    expect(batch).toMatchObject({ matched: 0, synced: 0 });
  });

  it("reports more to do while a full window comes back, and pages from the offset", async () => {
    counts(25, 10);
    membershipFindMany.mockResolvedValue([
      member("m11", "a@example.com"),
      member("m12", "b@example.com"),
    ]);

    const batch = await syncOrgSlackIds("org1", 10, 2);

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 2, orderBy: { id: "asc" } })
    );
    // processed = where the client's next offset should start.
    expect(batch).toMatchObject({ processed: 12, total: 25, done: false });
  });

  it("is done when the last window comes back short", async () => {
    counts(12, 12);
    membershipFindMany.mockResolvedValue([member("m12", "z@example.com")]);

    const batch = await syncOrgSlackIds("org1", 10, 10);

    expect(batch).toMatchObject({ processed: 11, done: true });
  });

  it("returns null when the org has no workspace connected", async () => {
    orgFindUnique.mockResolvedValue({ slackBotToken: null });

    expect(await syncOrgSlackIds("org1", 0, 10)).toBeNull();
    expect(membershipFindMany).not.toHaveBeenCalled();
  });
});
