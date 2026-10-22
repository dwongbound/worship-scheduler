// Unit tests for the message-TEXT builders in lib/slack.ts — the pure half that
// turns a roster into words. The transport (endpoints, dry-run, rate limiting) is
// tested in tests/unit/chatTransport.test.ts; the notify* helpers aren't tested
// here because they query prisma.
//
// Both builders take a ChatFormat and default to Slack's, so these cases assert
// Slack mrkdwn — the same output they always did.
import { describe, expect, it } from "vitest";
import { rosterDmText, teamRosterText, weeklySummaryText } from "@/lib/slack";
import { SLACK_FORMAT } from "@/lib/integrations/slack/format";

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

  it("lists people scarce-first and marks the designated MD, never the WL", () => {
    const text = weeklySummaryText("Sunday Team", range, [
      {
        label: "Sunday Worship",
        startsAt: new Date("2026-07-12T10:00:00"),
        mdUserId: "u-bob", // Bob on keys is the MD
        assignments: [
          { role: "DRUMS", user: { id: "u-ryan", name: "Ryan" } },
          { role: "KEYS", user: { id: "u-bob", name: "Bob" } },
          { role: "WORSHIP_LEADER", user: { id: "u-alice", name: "Alice" } },
        ],
      },
    ]);
    // join("\n\n") → title, blank line, then the set block.
    const lines = text.split("\n");
    expect(lines[0]).toContain("*Sunday Team*");
    expect(lines[2]).toContain("`Sunday Worship`");
    // ROLE_ORDER is WL, DRUMS, BASS, KEYS, … → WL, then Drums, then Keys.
    expect(lines[3]).toBe("• Alice — Worship Leader");
    expect(lines[4]).toBe("• Ryan — Drums");
    expect(lines[5]).toBe("• Bob — Keys (MD)");
  });

  it("follows the team's own role order and labels when given a catalog", () => {
    // The admin dragged Keys to the top and renamed Vox — the summary has to
    // read the way their team's roster reads everywhere else.
    const catalog = [
      { key: "KEYS", label: "Piano", defaultCount: 1, adminOnly: false, order: 0 },
      { key: "VOCALS", label: "Backing Vox", defaultCount: 2, adminOnly: false, order: 1 },
      { key: "DRUMS", label: "Drums", defaultCount: 1, adminOnly: false, order: 2 },
    ];
    const text = weeklySummaryText(
      "Sunday Team",
      range,
      [
        {
          label: "Sunday Worship",
          startsAt: new Date("2026-07-12T10:00:00"),
          mdUserId: null,
          assignments: [
            { role: "DRUMS", user: { id: "u-ryan", name: "Ryan" } },
            { role: "VOCALS", user: { id: "u-cara", name: "Cara" } },
            { role: "KEYS", user: { id: "u-bob", name: "Bob" } },
            // A role the team has since dropped still gets listed — last.
            { role: "BASS", user: { id: "u-dee", name: "Dee" } },
          ],
        },
      ],
      catalog
    );
    const lines = text.split("\n");
    expect(lines.slice(3, 7)).toEqual([
      "• Bob — Piano",
      "• Cara — Backing Vox",
      "• Ryan — Drums",
      "• Dee — Bass",
    ]);
  });

  it("uses a fallback name and placeholder line for empty unnamed sets", () => {
    const text = weeklySummaryText("Sunday Team", range, [
      {
        label: null,
        startsAt: new Date("2026-07-12T10:00:00"),
        mdUserId: null,
        assignments: [],
      },
    ]);
    expect(text).toContain("`Worship set`");
    expect(text).toContain("• _No one assigned yet_");
  });
});

describe("rosterDmText", () => {
  const fmt = SLACK_FORMAT;
  const sun = (day: number, label = "Sunday AM") => ({
    label,
    startsAt: new Date(2026, 10, day, 10),
  });
  const change = (
    kind: "added" | "removed",
    setId: string,
    day: number,
    role = "SOUND"
  ) => ({ kind, role, setId, set: sun(day) });

  it("keeps a lone change as the one-line DM it always was", () => {
    expect(rosterDmText([change("added", "s1", 1, "KEYS")], fmt, "https://x/calendar")).toBe(
      `👍 *New Set:* Keys for \`Sunday AM\` on 11/1/26 10AM.`
    );
    expect(rosterDmText([change("removed", "s1", 1)], fmt, "")).toBe(
      `👋 *Set Update:* No longer on \`Sunday AM\` on 11/1/26 10AM.`
    );
  });

  it("folds many sets into ONE message, oldest first, added before removed", () => {
    const text = rosterDmText(
      [
        change("added", "s3", 15),
        change("removed", "s9", 22),
        change("added", "s1", 1),
        change("added", "s2", 8),
      ],
      fmt,
      ""
    );
    const lines = text.split("\n");
    expect(lines[0]).toBe(`👍 *New Sets 3:*`);
    expect(lines.slice(1, 4).map((l) => l.match(/(\d+\/\d+\/\d+ \d+[AP]M)/)![1])).toEqual([
      "11/1/26 10AM",
      "11/8/26 10AM",
      "11/15/26 10AM",
    ]);
    expect(lines[5]).toBe(`👋 *No Longer On 1:*`);
    expect(lines[6]).toContain("11/22/26 10AM");
    expect(lines).toHaveLength(7);
  });

  it("links each date to its set and asks to confirm only when something was added", () => {
    const old = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "https://app.test";
    try {
      const added = rosterDmText(
        [change("added", "s1", 1), change("added", "s2", 8)],
        fmt,
        "https://app.test/calendar"
      );
      expect(added).toContain("<https://app.test/calendar?set=s1|11/1/26 10AM>");
      expect(added.endsWith("Confirm <https://app.test/calendar|here>.")).toBe(true);
      const removed = rosterDmText(
        [change("removed", "s1", 1), change("removed", "s2", 8)],
        fmt,
        "https://app.test/calendar"
      );
      expect(removed).not.toContain("Confirm");
      // Mixed: "Confirm" closes the sets they picked up, not the ones they left.
      const mixed = rosterDmText(
        [change("added", "s1", 1), change("removed", "s2", 8)],
        fmt,
        "https://app.test/calendar"
      ).split("\n\n");
      expect(mixed[0].endsWith("Confirm <https://app.test/calendar|here>.")).toBe(true);
      expect(mixed[1]).not.toContain("Confirm");
    } finally {
      process.env.NEXTAUTH_URL = old;
    }
  });
});
