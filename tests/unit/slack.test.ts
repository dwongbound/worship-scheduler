// Unit tests for the Slack Web API wrapper (lib/slack.ts). We mock global
// fetch so nothing hits the network, and toggle SLACK_BOT_TOKEN to check the
// no-op path. The notify* helpers aren't tested here — they query prisma.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  slackEnabled,
  postDirectMessage,
  postToChannel,
  openGroupConversation,
} from "@/lib/slack";

// Build a fetch mock that returns the given JSON bodies in sequence (one per
// Slack API call), so we can script conversations.open → chat.postMessage.
function mockFetchSequence(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of responses) {
    fetchMock.mockResolvedValueOnce({ json: async () => body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ORIGINAL_TOKEN = process.env.SLACK_BOT_TOKEN;

beforeEach(() => {
  process.env.SLACK_BOT_TOKEN = "xoxb-test-token";
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.SLACK_BOT_TOKEN = ORIGINAL_TOKEN;
});

describe("slackEnabled", () => {
  it("is true only when SLACK_BOT_TOKEN is set", () => {
    expect(slackEnabled()).toBe(true);
    delete process.env.SLACK_BOT_TOKEN;
    expect(slackEnabled()).toBe(false);
  });
});

describe("when Slack is not configured", () => {
  it("postDirectMessage no-ops without calling fetch", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const fetchMock = mockFetchSequence();
    const ok = await postDirectMessage("U123", "hi");
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("openGroupConversation returns null without calling fetch", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    const fetchMock = mockFetchSequence();
    const channel = await openGroupConversation(["U1", "U2"]);
    expect(channel).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("postDirectMessage", () => {
  it("opens a DM then posts to the returned channel", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, channel: { id: "D999" } }, // conversations.open
      { ok: true } // chat.postMessage
    );

    const ok = await postDirectMessage("U123", "hello");
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // 1st call opens the conversation with the user id…
    const [openUrl, openInit] = fetchMock.mock.calls[0];
    expect(openUrl).toContain("conversations.open");
    expect(JSON.parse((openInit as RequestInit).body as string)).toEqual({
      users: "U123",
    });

    // …2nd posts to the channel id that came back.
    const [postUrl, postInit] = fetchMock.mock.calls[1];
    expect(postUrl).toContain("chat.postMessage");
    expect(JSON.parse((postInit as RequestInit).body as string)).toEqual({
      channel: "D999",
      text: "hello",
    });
  });

  it("returns false and stops if opening the DM fails", async () => {
    const fetchMock = mockFetchSequence({ ok: false, error: "user_not_found" });
    const ok = await postDirectMessage("U123", "hello");
    expect(ok).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reached postMessage
  });
});

describe("openGroupConversation", () => {
  it("opens an MPIM with the comma-joined ids and returns its channel id", async () => {
    const fetchMock = mockFetchSequence({ ok: true, channel: { id: "G42" } });
    const channel = await openGroupConversation(["U1", "U2", "U3"]);
    expect(channel).toBe("G42");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      users: "U1,U2,U3",
    });
  });

  it("returns null for an empty user list without calling fetch", async () => {
    const fetchMock = mockFetchSequence();
    expect(await openGroupConversation([])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("postToChannel", () => {
  it("returns false when Slack reports not-ok", async () => {
    mockFetchSequence({ ok: false, error: "channel_not_found" });
    expect(await postToChannel("C1", "hi")).toBe(false);
  });

  it("swallows fetch errors instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    await expect(postToChannel("C1", "hi")).resolves.toBe(false);
  });
});
