// Unit tests for lib/slack.notifySetChange — the rule deciding when a set's
// group chat hears about a change. prisma is mocked (this helper reads the set
// and the org's bot token); fetch is mocked so nothing hits Slack.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    set: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
  },
}));

import { notifySetChange } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

const setFindUnique = prisma.set.findUnique as unknown as ReturnType<typeof vi.fn>;
const orgFindUnique = prisma.org.findUnique as unknown as ReturnType<typeof vi.fn>;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-08-18T12:00:00Z");

// A set 3 days out with a 7-day lead time and a chat already created — the
// "should notify" baseline each test below varies one field of.
function aSet(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org1",
    startsAt: new Date(NOW.getTime() + 3 * DAY_MS),
    groupChatLeadDays: 7,
    groupChatChannelId: "C123",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  process.env.NEXTAUTH_SECRET = "test-secret";
  delete process.env.SLACK_DRY_RUN;
  orgFindUnique.mockResolvedValue({ slackBotToken: encryptSecret("xoxb-test") });
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("notifySetChange", () => {
  it("posts to the set's channel inside the group-chat window", async () => {
    setFindUnique.mockResolvedValue(aSet());
    await notifySetChange("set1", "🎵 Setlist update");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("chat.postMessage");
    expect(JSON.parse(init.body)).toMatchObject({
      channel: "C123",
      text: "🎵 Setlist update",
    });
  });

  it("stays silent when auto group chat is off (None)", async () => {
    setFindUnique.mockResolvedValue(aSet({ groupChatLeadDays: null }));
    await notifySetChange("set1", "change");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent before the lead window opens", async () => {
    // 30 days out, 7-day lead: the chat doesn't exist for another 23 days.
    setFindUnique.mockResolvedValue(
      aSet({ startsAt: new Date(NOW.getTime() + 30 * DAY_MS) })
    );
    await notifySetChange("set1", "change");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent once the set is over", async () => {
    setFindUnique.mockResolvedValue(
      aSet({ startsAt: new Date(NOW.getTime() - 1 * DAY_MS) })
    );
    await notifySetChange("set1", "change");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent when no channel has been created yet", async () => {
    setFindUnique.mockResolvedValue(aSet({ groupChatChannelId: null }));
    await notifySetChange("set1", "change");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent when the org has no Slack connection", async () => {
    setFindUnique.mockResolvedValue(aSet());
    orgFindUnique.mockResolvedValue({ slackBotToken: null });
    await notifySetChange("set1", "change");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws when the lookup fails", async () => {
    setFindUnique.mockRejectedValue(new Error("db down"));
    await expect(notifySetChange("set1", "change")).resolves.toBeUndefined();
  });
});
