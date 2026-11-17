// Unit tests for lib/slack.notifyCoverDeclined — the DM the owner of a slot
// gets when an eligible player says "not me" to their open cover request.
//
// prisma is mocked (the helper reads the assignment, the org's bot token and
// the owner's per-org Slack id); fetch is mocked so nothing hits Slack. The
// point of the cases is the COPY: the house template (emoji + bold label, the
// set as code, one date format, a labelled link) and the optional note, which
// is the only part the owner can't work out for themselves.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assignment: { findUnique: vi.fn() },
    org: { findUnique: vi.fn() },
    orgMembership: { findUnique: vi.fn() },
  },
}));

import { notifyCoverDeclined } from "@/lib/slack";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/crypto";

const assignmentFindUnique = prisma.assignment
  .findUnique as unknown as ReturnType<typeof vi.fn>;
const orgFindUnique = prisma.org.findUnique as unknown as ReturnType<typeof vi.fn>;
const membershipFindUnique = prisma.orgMembership
  .findUnique as unknown as ReturnType<typeof vi.fn>;

// Ryan's drums slot on a Saturday-morning set, up for cover.
function anAssignment(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    setId: "set1",
    userId: "u-ryan",
    role: "DRUMS",
    user: { id: "u-ryan" },
    set: {
      label: "Prayer",
      startsAt: new Date("2026-10-31T07:00:00"),
      orgId: "org1",
    },
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

// The text of the one DM that went out.
function sentText(): string {
  expect(fetchMock).toHaveBeenCalled();
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
  assignmentFindUnique.mockResolvedValue(anAssignment());
  orgFindUnique.mockResolvedValue({
    name: "Grace",
    slackBotToken: encryptSecret("xoxb-test"),
    notificationPrefs: null,
  });
  // A cached DM channel, so the send is the one chat.postMessage call and
  // not an extra conversations.open round trip (see MessagingTransport.postDm).
  membershipFindUnique.mockResolvedValue({
    id: "m-ryan",
    slackUserId: "U-RYAN",
    slackDmChannelId: "D-RYAN",
  });
  fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("notifyCoverDeclined", () => {
  it("DMs the owner in the house template, quoting the note", async () => {
    await notifyCoverDeclined("a1", "Maria", "I'm away that week");

    const text = sentText();
    // Emoji + bold label, set as code, the one compact date format, and a
    // LABELLED link — never a bare URL, and the markup stays outside it.
    expect(text).toContain("*Cover Declined:*");
    expect(text).toContain("`Prayer`");
    expect(text).toContain("10/31/26 7AM");
    expect(text).toContain('"I\'m away that week"');
    expect(text).toContain("Maria can't take your Drums slot");
    expect(text).toContain(
      "<https://app.example.com/set-manager?set=set1|here>"
    );
    // The slot is still theirs and still open — the DM has to say so.
    expect(text).toContain("Still open to everyone else");
  });

  it("just ends the sentence when no note was left", async () => {
    await notifyCoverDeclined("a1", "Maria", null);

    const text = sentText();
    expect(text).toContain("at 10/31/26 7AM. Still open");
    expect(text).not.toContain('"');
  });

  it("stays silent when the org switched this notification off", async () => {
    orgFindUnique.mockResolvedValue({
      name: "Grace",
      slackBotToken: encryptSecret("xoxb-test"),
      notificationPrefs: { COVER_DECLINED: false },
    });
    await notifyCoverDeclined("a1", "Maria", null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays silent when the owner has no Slack id in that org", async () => {
    membershipFindUnique.mockResolvedValue({
      id: "m-ryan",
      slackUserId: null,
      slackDmChannelId: null,
    });
    await notifyCoverDeclined("a1", "Maria", null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
