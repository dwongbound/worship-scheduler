// Unit tests for the messaging layer (lib/chatTransport + lib/integrations).
//
// Two jobs:
//   1. SlackTransport still behaves exactly as the old lib/slack wrapper did —
//      same endpoints, same bodies, same no-op and dry-run paths. These cases are
//      migrated straight from tests/unit/slack.test.ts.
//   2. The shared behaviour in MessagingTransport (chunking, never-throw, the DM
//      channel cache) works for ANY provider — proved with a FakeTransport that
//      implements only the hooks, which is exactly what adding Discord involves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { orgMembership: { update: vi.fn().mockResolvedValue({}) } },
}));

import { SlackTransport } from "@/lib/integrations/slack";
import { prisma } from "@/lib/prisma";
import { splitMessage } from "@/lib/messageFormat";
import { DISCORD_FORMAT } from "@/lib/integrations/discord/format";
import {
  MessagingTransport,
  type Attempt,
  type EmailLookup,
  type MessagingCapabilities,
  type IntegrationName,
  type DmTarget,
} from "@/lib/messagingTransport";
import { createRateLimiter } from "@/lib/rateLimit";

// Build a fetch mock returning the given JSON bodies in sequence (one per API
// call), so we can script conversations.open → chat.postMessage.
function mockFetchSequence(...responses: unknown[]) {
  const fetchMock = vi.fn();
  for (const body of responses) {
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const slack = (token: string | null = "xoxb-test-token") => new SlackTransport(token);

beforeEach(() => {
  // Ambient dry-run (a dev container in dry-run mode) would make every call
  // succeed without fetch — clear both spellings for these tests.
  delete process.env.SLACK_DRY_RUN;
  delete process.env.INTEGRATION_DRY_RUN;
  vi.mocked(prisma.orgMembership.update).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SLACK_DRY_RUN;
  delete process.env.INTEGRATION_DRY_RUN;
});

describe("when chat is not configured (no credential)", () => {
  it("postDirectMessage no-ops without calling fetch", async () => {
    const fetchMock = mockFetchSequence();
    expect(await slack(null).postDirectMessage("U123", "hi")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("createGroupChat returns null without calling fetch", async () => {
    const fetchMock = mockFetchSequence();
    expect(await slack(null).createGroupChat("jul-12-sunday")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("dry-run mode", () => {
  it("reports success and never calls fetch — even without a credential", async () => {
    process.env.SLACK_DRY_RUN = "1";
    const fetchMock = mockFetchSequence();
    expect(await slack(null).postDirectMessage("U123", "hi")).toBe(true);
    expect(await slack(null).createGroupChat("jul-12-sunday")).toBe("C_DRY_RUN");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is also spelled INTEGRATION_DRY_RUN, so the flag isn't Slack-specific", async () => {
    process.env.INTEGRATION_DRY_RUN = "true";
    const fetchMock = mockFetchSequence();
    expect(await slack(null).postToChannel("C1", "hi")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SlackTransport.postDirectMessage", () => {
  it("opens a DM then posts to the returned channel", async () => {
    const fetchMock = mockFetchSequence(
      { ok: true, channel: { id: "D999" } }, // conversations.open
      { ok: true } // chat.postMessage
    );

    expect(await slack().postDirectMessage("U123", "hello")).toBe(true);
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
    expect(await slack().postDirectMessage("U123", "hello")).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // never reached postMessage
  });
});

describe("SlackTransport.createGroupChat", () => {
  it("creates a private channel and returns its id", async () => {
    const fetchMock = mockFetchSequence({ ok: true, channel: { id: "C42" } });
    expect(await slack().createGroupChat("jul-12-sunday")).toBe("C42");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("conversations.create");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      name: "jul-12-sunday",
      is_private: true,
    });
  });

  it("retries with a counted suffix when the name is taken", async () => {
    const fetchMock = mockFetchSequence(
      { ok: false, error: "name_taken" }, // first candidate clashes
      { ok: true, channel: { id: "C99" } } // suffixed candidate succeeds
    );
    expect(await slack().createGroupChat("jul-12-sunday")).toBe("C99");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The retry appends a readable counter — never a random hash, since people
    // read these channel names in Slack.
    const nameAt = (i: number) =>
      JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).name;
    expect(nameAt(0)).toBe("jul-12-sunday");
    expect(nameAt(1)).toBe("jul-12-sunday-2");
  });

  it("returns null when every attempt fails", async () => {
    mockFetchSequence(
      { ok: false, error: "name_taken" },
      { ok: false, error: "name_taken" },
      { ok: false, error: "name_taken" }
    );
    expect(await slack().createGroupChat("x")).toBeNull();
  });
});

describe("SlackTransport.inviteToGroupChat", () => {
  it("invites the comma-joined ids to the channel", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    await slack().inviteToGroupChat("C1", ["U1", "U2", "U3"]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("conversations.invite");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      channel: "C1",
      users: "U1,U2,U3",
    });
  });

  it("does nothing (no fetch) for an empty id list", async () => {
    const fetchMock = mockFetchSequence();
    await slack().inviteToGroupChat("C1", []);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SlackTransport.archiveGroupChat", () => {
  it("archives the channel and returns true on success", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    expect(await slack().archiveGroupChat("C1")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("conversations.archive");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      channel: "C1",
    });
  });

  it("returns false when Slack reports not-ok", async () => {
    mockFetchSequence({ ok: false, error: "channel_not_found" });
    expect(await slack().archiveGroupChat("C1")).toBe(false);
  });
});

describe("SlackTransport.setGroupChatTopic", () => {
  it("posts the channel + topic and returns true on success", async () => {
    const fetchMock = mockFetchSequence({ ok: true });
    const ok = await slack().setGroupChatTopic("G42", "Sunday Set (July 12 · 10:00 AM)");
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
    expect(await slack().setGroupChatTopic("G42", "topic")).toBe(false);
  });
});

describe("SlackTransport.lookupUserIdByEmail", () => {
  it("returns the member id the workspace knows for that email", async () => {
    const fetchMock = mockFetchSequence({ ok: true, user: { id: "U7" } });
    expect(await slack().lookupUserIdByEmail("a@b.com")).toEqual({
      kind: "found",
      userId: "U7",
    });
    expect(fetchMock.mock.calls[0][0]).toContain("users.lookupByEmail");
  });

  it("reports a genuine absence as not-found, not as a failure", async () => {
    mockFetchSequence({ ok: false, error: "users_not_found" });
    expect(await slack().lookupUserIdByEmail("a@b.com")).toEqual({
      kind: "not-found",
    });
  });

  it("reports a REJECTED lookup as a failure, carrying Slack's reason", async () => {
    // The distinction the sweep lives on. `invalid_arguments` is the request
    // being wrong, not the person being absent — read as "not in the workspace"
    // it turns a wholly broken sync into a clean run where nobody matched.
    mockFetchSequence({ ok: false, error: "invalid_arguments" });
    expect(await slack().lookupUserIdByEmail("a@b.com")).toEqual({
      kind: "failed",
      error: "invalid_arguments",
    });
  });

  it("reports a bad token as a failure too", async () => {
    mockFetchSequence({ ok: false, error: "invalid_auth" });
    expect(await slack().lookupUserIdByEmail("a@b.com")).toEqual({
      kind: "failed",
      error: "invalid_auth",
    });
  });

  it("declares the capability, which is what Discord will not be able to do", () => {
    expect(slack().capabilities.emailLookup).toBe(true);
  });
});

describe("rate limiting (shared)", () => {
  it("honours a 429's Retry-After and retries once", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce({
      status: 429,
      headers: { get: () => "0.01" }, // 10ms — a real wait, without a slow suite
      json: async () => ({ ok: false, error: "ratelimited" }),
    });
    fetchMock.mockResolvedValueOnce({ status: 200, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await slack().postToChannel("C1", "hi")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up (without throwing) when still limited after the retry", async () => {
    const limited = {
      status: 429,
      headers: { get: () => "0.01" },
      json: async () => ({ ok: false, error: "ratelimited" }),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(limited));
    expect(await slack().postToChannel("C1", "hi")).toBe(false);
  });
});

describe("never-throw contract (shared)", () => {
  it("swallows fetch errors instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(slack().postToChannel("C1", "hi")).resolves.toBe(false);
  });

  it("returns false when the provider reports not-ok", async () => {
    mockFetchSequence({ ok: false, error: "channel_not_found" });
    expect(await slack().postToChannel("C1", "hi")).toBe(false);
  });
});

// ── A second provider, to prove the seam ───────────────────────────────────
//
// Everything below uses a transport that implements ONLY the hooks — no Slack
// anywhere. If adding Discord required touching the base class or the notifiers,
// this wouldn't compile.

const FAKE_CAPS: MessagingCapabilities = {
  emailLookup: false, // like Discord: no member email at any permission level
  groupChatTopics: false,
  inlineLinks: false,
  guaranteedDms: false,
};

class FakeTransport extends MessagingTransport {
  readonly integration = "DISCORD" as IntegrationName;
  readonly capabilities = FAKE_CAPS;
  readonly fmt = DISCORD_FORMAT;
  /** Every message this transport was asked to send, in order. */
  readonly sent: { channelId: string; text: string }[] = [];

  constructor(credential: string | null = "fake-token") {
    super(credential);
  }

  protected limiter() {
    return createRateLimiter(0);
  }
  protected buildRequest(op: string, body: Record<string, unknown>) {
    return { url: `https://example.test/${op}`, init: { method: "POST", body: JSON.stringify(body) } };
  }
  protected async interpret(): Promise<Attempt> {
    return { kind: "ok", data: {} };
  }
  protected dryRunResponse() {
    return {};
  }
  protected memberId(m: DmTarget) {
    return m.slackUserId;
  }
  protected cachedDmChannel(m: DmTarget) {
    return m.slackDmChannelId;
  }
  protected readonly dmChannelColumn = "slackDmChannelId";

  protected async sendMessage(channelId: string, text: string) {
    this.sent.push({ channelId, text });
    return true;
  }
  async openDmChannel(userId: string) {
    return `dm-${userId}`;
  }
  async createGroupChat(name: string) {
    return `thread-${name}`;
  }
  async inviteToGroupChat() {}
  async archiveGroupChat() {
    return true;
  }
  async setGroupChatTopic() {
    return false; // threads have no topic
  }
  async lookupUserIdByEmail(): Promise<EmailLookup> {
    // Not possible on this provider — which is a "not-found", not a failure.
    return { kind: "not-found" };
  }
}

describe("message chunking (shared, per-provider limit)", () => {
  it("splits a message past the provider's ceiling and sends the parts in order", async () => {
    const fake = new FakeTransport();
    // 60 lines of 100 chars = ~6060 chars, over Discord's 2000.
    const text = Array.from({ length: 60 }, (_, i) => `${i}`.padEnd(100, "x")).join("\n");
    expect(await fake.postToChannel("C1", text)).toBe(true);

    expect(fake.sent.length).toBeGreaterThan(1);
    for (const part of fake.sent) {
      expect(part.text.length).toBeLessThanOrEqual(DISCORD_FORMAT.maxChars);
    }
    // Nothing is lost and nothing is reordered.
    expect(fake.sent.map((p) => p.text).join("\n")).toBe(text);
  });

  it("sends a short message as one piece, and an empty one not at all", async () => {
    const fake = new FakeTransport();
    expect(await fake.postToChannel("C1", "hi")).toBe(true);
    expect(fake.sent).toEqual([{ channelId: "C1", text: "hi" }]);

    expect(await fake.postToChannel("C1", "")).toBe(false);
    expect(fake.sent).toHaveLength(1); // no blank message
  });
});

describe("DM channel cache (shared)", () => {
  const member = (overrides: Partial<DmTarget> = {}): DmTarget => ({
    id: "m1",
    slackUserId: "U1",
    slackDmChannelId: null,
    ...overrides,
  });

  it("opens the DM once and caches the channel id on the membership", async () => {
    const fake = new FakeTransport();
    expect(await fake.postDm(member(), "hi")).toBe(true);
    expect(fake.sent[0].channelId).toBe("dm-U1");
    expect(prisma.orgMembership.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { slackDmChannelId: "dm-U1" },
    });
  });

  it("reuses a cached channel without opening or re-caching", async () => {
    const fake = new FakeTransport();
    expect(await fake.postDm(member({ slackDmChannelId: "dm-cached" }), "hi")).toBe(true);
    expect(fake.sent[0].channelId).toBe("dm-cached");
    expect(prisma.orgMembership.update).not.toHaveBeenCalled();
  });

  it("clears a stale cached channel when posting to it fails", async () => {
    class Failing extends FakeTransport {
      protected async sendMessage() {
        return false;
      }
    }
    expect(await new Failing().postDm(member({ slackDmChannelId: "dm-stale" }), "hi")).toBe(
      false
    );
    expect(prisma.orgMembership.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { slackDmChannelId: null },
    });
  });

  it("does nothing for someone who hasn't linked their chat account", async () => {
    const fake = new FakeTransport();
    expect(await fake.postDm(member({ slackUserId: null }), "hi")).toBe(false);
    expect(fake.sent).toHaveLength(0);
  });
});

describe("splitMessage", () => {
  it("returns the text whole when it fits", () => {
    expect(splitMessage("short", 100)).toEqual(["short"]);
  });

  it("returns nothing for an empty string", () => {
    expect(splitMessage("", 100)).toEqual([]);
  });

  it("breaks on line boundaries rather than mid-line", () => {
    const parts = splitMessage("aaaa\nbbbb\ncccc", 10);
    expect(parts).toEqual(["aaaa\nbbbb", "cccc"]);
  });

  it("hard-splits a single line too long to fit", () => {
    expect(splitMessage("abcdefg", 3)).toEqual(["abc", "def", "g"]);
  });
});

describe("SlackTransport request encoding", () => {
  // This is the case the mocks used to wave through. Every test here scripts a
  // response and asserts on the RESULT, so a request Slack would reject looked
  // exactly like one it would accept — which is how a lookup that never worked
  // in production sat behind a green suite.
  it("sends users.lookupByEmail form-encoded, not as JSON", async () => {
    const fetchMock = mockFetchSequence({ ok: true, user: { id: "U123" } });

    expect(await slack().lookupUserIdByEmail("kate@example.com")).toEqual({
      kind: "found",
      userId: "U123",
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/users.lookupByEmail");
    // Slack parses form parameters only for this method. Handed JSON it sees no
    // arguments at all and answers `invalid_arguments` — which reads like a bad
    // email address rather than a bad request, so it hid for a long time.
    expect(init.headers["Content-Type"]).toMatch(/application\/x-www-form-urlencoded/);
    expect(init.body).toBe("email=kate%40example.com");
    // The token still travels in the header, not the body.
    expect(init.headers.Authorization).toBe("Bearer xoxb-test-token");
  });

  it("still sends everything else as JSON", async () => {
    const fetchMock = mockFetchSequence({ ok: true, channel: { id: "C1" } });

    await slack().setGroupChatTopic("C1", "Sunday Morning");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://slack.com/api/conversations.setTopic");
    expect(init.headers["Content-Type"]).toMatch(/application\/json/);
    expect(JSON.parse(init.body)).toEqual({
      channel: "C1",
      topic: "Sunday Morning",
    });
  });

  it("form-encodes special characters rather than pasting them in raw", async () => {
    // A + in an address is a real and common thing, and is exactly what naive
    // string concatenation turns into a space.
    const fetchMock = mockFetchSequence({ ok: true, user: { id: "U9" } });

    await slack().lookupUserIdByEmail("kate+worship@example.com");

    expect(fetchMock.mock.calls[0][1].body).toBe("email=kate%2Bworship%40example.com");
  });
});
