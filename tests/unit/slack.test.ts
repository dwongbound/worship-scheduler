// Unit tests for the Slack Web API wrapper (lib/slack.ts). We mock global
// fetch so nothing hits the network, and toggle SLACK_BOT_TOKEN to check the
// no-op path. The notify* helpers aren't tested here — they query prisma.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  slackEnabled,
  postDirectMessage,
  postToChannel,
  openGroupConversation,
  setConversationTopic,
  teamRosterText,
  weeklySummaryText,
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
  // Ambient SLACK_DRY_RUN (e.g. a dev container running dry-run mode) would
  // make slackEnabled() true even with no token — clear it for these tests.
  delete process.env.SLACK_DRY_RUN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.SLACK_BOT_TOKEN = ORIGINAL_TOKEN;
  delete process.env.SLACK_DRY_RUN;
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

describe("dry-run mode (SLACK_DRY_RUN=1)", () => {
  it("enables Slack, reports success, and never calls fetch — even without a token", async () => {
    delete process.env.SLACK_BOT_TOKEN;
    process.env.SLACK_DRY_RUN = "1";
    const fetchMock = mockFetchSequence();

    expect(slackEnabled()).toBe(true);
    // Full DM path: conversations.open (fake channel id) → chat.postMessage.
    expect(await postDirectMessage("U123", "hi")).toBe(true);
    expect(await openGroupConversation(["U1", "U2"])).toBe("C_DRY_RUN");
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

describe("setConversationTopic", () => {
  it("posts the channel + topic and returns true on success", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    const ok = await setConversationTopic("G42", "Sunday Set (July 12 · 10:00 AM)");
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("conversations.setTopic");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      channel: "G42",
      topic: "Sunday Set (July 12 · 10:00 AM)",
    });
  });

  it("returns false when Slack reports not-ok", async () => {
    mockFetchSequence({ ok: false, error: "method_not_supported_for_channel_type" });
    expect(await setConversationTopic("G42", "topic")).toBe(false);
  });
});

describe("teamRosterText", () => {
  it("groups names by role in scarce-first order, skipping unfilled roles", () => {
    const text = teamRosterText([
      { role: "VOCALS", user: { name: "Bob" } },
      { role: "WORSHIP_LEADER", user: { name: "Alice" } },
      { role: "VOCALS", user: { name: "Carol" } },
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("*Worship Leader:* Alice");
    expect(lines[1]).toBe("*Vox:* Bob, Carol");
    expect(lines).toHaveLength(2);
  });

  it("returns an empty string for no assignments", () => {
    expect(teamRosterText([])).toBe("");
  });
});

describe("weeklySummaryText", () => {
  const range = {
    start: new Date("2026-07-10T12:00:00"),
    end: new Date("2026-07-17T12:00:00"),
  };

  it("lists each set's people in scarce-first role order with an (MD) marker", () => {
    const text = weeklySummaryText("Sunday Team", range, [
      {
        label: "Sunday Worship",
        startsAt: new Date("2026-07-12T10:00:00"),
        assignments: [
          { role: "DRUMS", user: { name: "Ryan", isMD: false } },
          { role: "WORSHIP_LEADER", user: { name: "Alice", isMD: true } },
        ],
      },
    ]);
    // join("\n\n") → title, blank line, then the set block.
    const lines = text.split("\n");
    expect(lines[0]).toContain("*Sunday Team*");
    expect(lines[2]).toContain("*Sunday Worship*");
    expect(lines[3]).toBe("• Alice — Worship Leader (MD)");
    expect(lines[4]).toBe("• Ryan — Drums");
  });

  it("uses a fallback name and placeholder line for empty unnamed sets", () => {
    const text = weeklySummaryText("Sunday Team", range, [
      {
        label: null,
        startsAt: new Date("2026-07-12T10:00:00"),
        assignments: [],
      },
    ]);
    expect(text).toContain("*Worship set*");
    expect(text).toContain("• _No one assigned yet_");
  });
});
