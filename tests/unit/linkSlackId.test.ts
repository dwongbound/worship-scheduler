// Unit tests for lib/slack.linkSlackIdForUser — the per-person email→member-id
// lookup that runs on sign-in and org-join, so nobody has to paste their Slack
// ID into /profile by hand. prisma is mocked (it reads the user + memberships
// and writes the id back); fetch is mocked so nothing hits Slack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    orgMembership: { findMany: vi.fn(), update: vi.fn() },
  },
}));

import { linkSlackIdForUser } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

const userFindUnique = prisma.user.findUnique as unknown as ReturnType<typeof vi.fn>;
const membershipFindMany = prisma.orgMembership
  .findMany as unknown as ReturnType<typeof vi.fn>;
const membershipUpdate = prisma.orgMembership
  .update as unknown as ReturnType<typeof vi.fn>;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
  delete process.env.SLACK_DRY_RUN;
  userFindUnique.mockResolvedValue({ email: "sam@example.com" });
  membershipFindMany.mockResolvedValue([
    { id: "m1", org: { slackBotToken: encryptSecret("xoxb-test") } },
  ]);
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

describe("linkSlackIdForUser", () => {
  it("looks the email up and caches the member id on the membership", async () => {
    await linkSlackIdForUser("u1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("users.lookupByEmail");
    // Form-encoded, not JSON: this method reads form parameters only, and a
    // JSON body makes it answer `invalid_arguments`. Asserting JSON here is
    // what let that ship — the request the test approved was one Slack would
    // always have rejected.
    expect(init.body).toBe("email=sam%40example.com");
    expect(membershipUpdate).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { slackUserId: "U9" },
    });
  });

  it("only considers memberships with no id yet, in orgs that installed the bot", async () => {
    await linkSlackIdForUser("u1");

    expect(membershipFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "u1",
          slackUserId: null,
          org: { slackBotToken: { not: null } },
        },
      })
    );
  });

  it("does nothing for an account with no email", async () => {
    userFindUnique.mockResolvedValue({ email: null });
    await linkSlackIdForUser("u1");
    expect(membershipFindMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the row alone when the email isn't in the workspace", async () => {
    // users_not_found — the usual case for someone not in Slack yet. It's
    // retried on their next sign-in, so nothing needs recording here.
    fetchMock.mockResolvedValue({
      json: async () => ({ ok: false, error: "users_not_found" }),
    });
    await linkSlackIdForUser("u1");
    expect(membershipUpdate).not.toHaveBeenCalled();
  });

  it("swallows the unique-constraint hit when a Slack account is already linked", async () => {
    membershipUpdate.mockRejectedValue(new Error("unique constraint"));
    await expect(linkSlackIdForUser("u1")).resolves.toBeUndefined();
  });

  it("makes no Slack call when a token can't be decrypted", async () => {
    membershipFindMany.mockResolvedValue([
      { id: "m1", org: { slackBotToken: "not-a-valid-ciphertext" } },
    ]);
    await linkSlackIdForUser("u1");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(membershipUpdate).not.toHaveBeenCalled();
  });
});
