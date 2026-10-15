// Unit tests for lib/slack.notifySwapResolved — the DM the PROPOSER of a
// targeted trade gets once the other person answers.
//
// prisma is mocked (the helper reads the proposal, the org's bot token and
// both parties' per-org Slack ids); fetch is mocked so nothing hits Slack.
// The cases are about the COPY, and especially the decline's optional note:
// it's stored on SwapProposal.declineNote by POST
// /api/swaps/proposals/:id/respond, and this is the only place it's read.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    swapProposal: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    orgMembership: { findMany: vi.fn() },
  },
}));

import { notifySwapResolved } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

const proposalFindUnique = prisma.swapProposal
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const orgFindUnique = prisma.org.findUnique as unknown as ReturnType<typeof vi.fn>;
const membershipFindMany = prisma.orgMembership
  .findMany as unknown as ReturnType<typeof vi.fn>;

// Henry proposed trading his drums seat on `Sunday Morning` for Quinn's seat
// on `Saturday Prayer`. Quinn is the one who answers.
function aProposal(overrides: Record<string, unknown> = {}) {
  return {
    requestedById: "u-henry",
    recipientId: "u-quinn",
    requestedBy: { name: "Henry Hill" },
    recipient: { name: "Quinn Quezada" },
    declineNote: null,
    fromAssignment: {
      role: "DRUMS",
      setId: "set-sunday",
      set: {
        label: "Sunday Morning",
        startsAt: new Date("2026-08-20T22:00:00"),
        orgId: "org1",
      },
    },
    toAssignment: {
      userId: "u-quinn",
      setId: "set-prayer",
      role: "DRUMS",
      set: {
        label: "Saturday Prayer",
        startsAt: new Date("2026-08-22T07:00:00"),
      },
    },
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function sentText(): string {
  const call = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("chat.postMessage")
  );
  expect(call).toBeDefined();
  return JSON.parse(call![1].body).text as string;
}

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "test-secret";
  process.env.NEXTAUTH_URL = "https://app.example.com";
  delete process.env.SLACK_DRY_RUN;
  proposalFindUnique.mockResolvedValue(aProposal());
  orgFindUnique.mockResolvedValue({
    name: "Grace",
    slackBotToken: encryptSecret("xoxb-test"),
    notificationPrefs: null,
  });
  // Cached DM channels, so each send is the one chat.postMessage call.
  membershipFindMany.mockResolvedValue([
    { id: "m-henry", userId: "u-henry", slackUserId: "U-HENRY", slackDmChannelId: "D-HENRY" },
    { id: "m-quinn", userId: "u-quinn", slackUserId: "U-QUINN", slackDmChannelId: "D-QUINN" },
  ]);
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("notifySwapResolved — declined", () => {
  it("names who declined and quotes their optional note", async () => {
    proposalFindUnique.mockResolvedValue(
      aProposal({ declineNote: "I'm away that week" })
    );
    await notifySwapResolved("p1", false);

    const text = sentText();
    // Same sentence as the cover decline: emoji + bold label, who, what,
    // the set as code, one date format, then the note as a quote.
    expect(text).toContain("*Swap Declined:*");
    expect(text).toContain("Quinn Quezada can't take your Drums slot");
    expect(text).toContain("`Sunday Morning`");
    expect(text).toContain("8/20/26 10PM");
    expect(text).toContain('"I\'m away that week"');
    // The reassurance, and a LABELLED link to the set they kept.
    expect(text).toContain("You're still on it.");
    expect(text).toContain(
      "<https://app.example.com/set-manager?set=set-sunday|here>"
    );
  });

  it("just ends the sentence when no note was left", async () => {
    await notifySwapResolved("p1", false);

    const text = sentText();
    expect(text).toContain("at 8/20/26 10PM. You're still on it.");
    expect(text).not.toContain('"');
  });

  it("quotes the note verbatim rather than punctuating it", async () => {
    // A note that already ends in a full stop must not gain a second one, and
    // one that doesn't must not have one bolted on inside the quotes.
    proposalFindUnique.mockResolvedValue(aProposal({ declineNote: "Away." }));
    await notifySwapResolved("p1", false);
    expect(sentText()).toContain('"Away."');
  });

  it("DMs the PROPOSER, not the person who declined", async () => {
    await notifySwapResolved("p1", false);
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("chat.postMessage")
    );
    expect(JSON.parse(call![1].body).channel).toBe("D-HENRY");
  });
});

describe("notifySwapResolved — accepted", () => {
  it("lists both new seats and carries no note", async () => {
    // declineNote is null on every accepted trade; the copy is unaffected
    // either way, which is what this pins.
    await notifySwapResolved("p1", true);

    const lines = sentText().split("\n");
    expect(lines[0]).toContain("*Swap Accepted:*");
    expect(lines[1]).toContain("You're on `Saturday Prayer`");
    expect(lines[2]).toContain("Quinn Quezada is on `Sunday Morning`");
    expect(lines[3]).toContain("See it ");
  });
});

describe("notifySwapResolved — silence", () => {
  it("says nothing when the org switched swap outcomes off", async () => {
    orgFindUnique.mockResolvedValue({
      name: "Grace",
      slackBotToken: encryptSecret("xoxb-test"),
      notificationPrefs: { SWAP_RESOLVED: false },
    });
    await notifySwapResolved("p1", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing when the proposer has no Slack id in that org", async () => {
    membershipFindMany.mockResolvedValue([
      { id: "m-quinn", userId: "u-quinn", slackUserId: "U-QUINN", slackDmChannelId: "D-QUINN" },
    ]);
    await notifySwapResolved("p1", false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
