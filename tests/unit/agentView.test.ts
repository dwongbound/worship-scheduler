import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentAvailability, agentCover, agentMySet, agentSet, setName, type AgentSetRow } from "@/lib/agentView";
import type { TeamRoleDef } from "@/lib/teamRoles";

const ORIGIN = "https://tapworship.example";

const role = (key: string, label: string, order: number): TeamRoleDef => ({
  key,
  label,
  defaultCount: 1,
  adminOnly: false,
  order,
});
const catalogs = new Map<string, TeamRoleDef[]>([
  ["band", [role("WL", "Worship leader", 0), role("KEYS", "Keys", 1), role("DRUMS", "Drums", 2)]],
  ["choir", [role("SOPRANO", "Soprano", 0)]],
]);

const row: AgentSetRow = {
  id: "set1",
  label: null,
  startsAt: new Date("2026-11-15T17:00:00Z"),
  durationMinutes: 90,
  teamId: "band",
  mdUserId: "me",
  org: { name: "Sunday Church" },
  team: { name: "Sunday Band" },
  md: { name: "Me" },
  assignments: [
    { id: "a3", role: "DRUMS", status: "CONFIRMED", userId: "u2", user: { name: "Dana" }, guestTeam: null },
    { id: "a1", role: "KEYS", status: "PENDING", userId: "me", user: { name: "Me" }, guestTeam: null },
    { id: "a2", role: "SOPRANO", status: "SWAP_REQUESTED", userId: "u3", user: { name: "Sam" }, guestTeam: { teamId: "choir" } },
  ],
  songs: [
    { title: "Second", key: null, order: 1 },
    { title: "First", key: "G", order: 0 },
  ],
  practices: [{ startsAt: new Date("2026-11-12T03:00:00Z"), endsAt: new Date("2026-11-12T05:00:00Z") }],
};

describe("agentSet", () => {
  const set = agentSet(row, catalogs, "me", ORIGIN);
  it("names the set by its team when it has no label, and gives its end", () => {
    expect(set.name).toBe("Sunday Band");
    expect(set.endsAt).toBe("2026-11-15T18:30:00.000Z");
    expect(set.link).toBe(`${ORIGIN}/calendar?set=set1`);
  });
  it("lists the roster in the team's role order, labels read from each seat's own team", () => {
    expect(set.roster.map((r) => `${r.role}:${r.name}`)).toEqual(["Keys:Me", "Drums:Dana", "Soprano:Sam"]);
    expect(set.roster.find((r) => r.you)?.status).toBe("Not confirmed yet");
  });
  it("puts the songs in setlist order and marks the viewer as MD", () => {
    expect(set.songs).toEqual([
      { title: "First", key: "G" },
      { title: "Second", key: null },
    ]);
    expect(set.youAreMusicalDirector).toBe(true);
  });
  it("carries no ids of other people, and no emails", () => {
    const text = JSON.stringify(set);
    expect(text).not.toContain("u2");
    expect(text).not.toContain("@");
  });
});

describe("agentMySet", () => {
  it("gives the viewer's own seats with the id the writing tools take", () => {
    const mine = agentMySet(row, catalogs, "me", ORIGIN);
    expect(mine.yourSeats).toEqual([
      { assignmentId: "a1", role: "Keys", status: "PENDING", statusInWords: "Not confirmed yet" },
    ]);
    expect(mine.needsYourConfirmation).toBe(true);
  });
});

describe("setName", () => {
  it("prefers the label, then the team, then a plain word", () => {
    expect(setName({ label: "Christmas Eve", team: { name: "Band" } })).toBe("Christmas Eve");
    expect(setName({ label: null, team: null })).toBe("Set");
  });
});

describe("agentCover", () => {
  it("names who asked, why, and links to the row with the Take button", () => {
    const cover = agentCover(
      {
        id: "a9",
        role: "DRUMS",
        reason: "Out of town",
        user: { name: "Dana" },
        set: { id: "set2", label: null, startsAt: row.startsAt, durationMinutes: 60, teamId: "band", org: { name: "Sunday Church" } },
      },
      catalogs,
      new Map([["band", "Sunday Band"]]),
      ORIGIN
    );
    expect(cover).toMatchObject({
      assignmentId: "a9",
      set: "Sunday Band",
      role: "Drums",
      askedBy: "Dana",
      reason: "Out of town",
      link: `${ORIGIN}/set-manager?set=set2`,
    });
  });
});

describe("agentAvailability", () => {
  it("says whether the viewer still owes the request", () => {
    expect(
      agentAvailability(
        {
          request: { name: "Winter", startDate: new Date("2026-12-01T08:00:00Z"), endDate: new Date("2027-02-28T08:00:00Z"), org: { name: "Sunday Church" } },
          needsResponse: true,
        },
        ORIGIN
      )
    ).toMatchObject({ org: "Sunday Church", request: "Winter", stillNeedsYourAvailability: true, link: `${ORIGIN}/schedule` });
  });
});

// A key is accepted ONLY where it's meant to be. getSessionUser never reads
// one, so the guard is source-level: no route but these names the key helpers.
describe("where an access key is accepted", () => {
  const KEY_ROUTES = [
    "app/api/agent/route.ts",
    "app/api/mcp/route.ts",
    "app/api/assignments/[id]/route.ts",
    "app/api/swaps/[id]/take/route.ts",
  ];

  /** Every route.ts under app/api, as repo-relative paths. */
  function routes(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return routes(path);
      return name === "route.ts" ? [path] : [];
    });
  }

  it("is only the agent and MCP endpoints and the two routes a key may write through", () => {
    const accepting = routes("app/api").filter((path) =>
      /getKeyUser|getActingUser/.test(readFileSync(path, "utf8"))
    );
    expect(accepting.sort()).toEqual([...KEY_ROUTES].sort());
  });
});
