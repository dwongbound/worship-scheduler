// Unit tests for the set detail modal's staged-edit layer (lib/setDraft.ts):
// what changed, in words, and what that means as API calls.
import { describe, expect, it } from "vitest";
import {
  describeSetChanges,
  diffAssignments,
  isLocalId,
  newLocalId,
  type DraftAssignment,
  type SetSnapshot,
} from "@/lib/setDraft";

const seat = (
  id: string,
  role: string,
  userId: string,
  name: string,
  guestTeamId: string | null = null
): DraftAssignment => ({ id, role, user: { id: userId, name }, guestTeamId });

// Built-in labels are enough here — a real caller passes roleLabel(key, catalog).
const labelFor = (role: string) =>
  ({ DRUMS: "Drums", KEYS: "Keys", VOCALS: "Vox", BASS: "Bass" })[role] ?? role;
const nameFor = (id: string) => ({ "u-a": "Alice", "u-b": "Bob" })[id] ?? id;

function snapshot(over: Partial<SetSnapshot> = {}): SetSnapshot {
  return {
    assignments: [],
    notes: "",
    songs: [],
    capacities: { DRUMS: 1, KEYS: 1, VOCALS: 2 },
    requiresMD: false,
    isPrivate: false,
    mdUserId: null,
    groupChatLeadDays: null,
    guestTeams: [],
    ...over,
  };
}

describe("newLocalId / isLocalId", () => {
  it("marks a locally-added seat and nothing else", () => {
    expect(isLocalId(newLocalId())).toBe(true);
    // A database cuid is never mistaken for one.
    expect(isLocalId("cl9xyz123")).toBe(false);
  });

  it("hands out distinct ids", () => {
    expect(newLocalId()).not.toBe(newLocalId());
  });
});

describe("diffAssignments", () => {
  it("reports a swap on a saved seat as an update, not a delete + add", () => {
    const before = [seat("a1", "DRUMS", "u-a", "Alice")];
    const after = [seat("a1", "DRUMS", "u-b", "Bob")];
    expect(diffAssignments(before, after)).toEqual({
      removed: [],
      reassigned: [{ id: "a1", userId: "u-b" }],
      added: [],
    });
  });

  it("reports a dropped seat as a delete", () => {
    const before = [seat("a1", "DRUMS", "u-a", "Alice")];
    expect(diffAssignments(before, [])).toEqual({
      removed: ["a1"],
      reassigned: [],
      added: [],
    });
  });

  it("reports a locally-added seat as an insert, carrying its guest row", () => {
    const id = newLocalId();
    const after = [seat(id, "VOCALS", "u-b", "Bob", "guest-1")];
    expect(diffAssignments([], after)).toEqual({
      removed: [],
      reassigned: [],
      added: [{ role: "VOCALS", userId: "u-b", guestTeamId: "guest-1" }],
    });
  });

  it("cancels out a seat added and removed in the same session", () => {
    const added = [seat(newLocalId(), "KEYS", "u-a", "Alice")];
    // Added, then taken back out before saving — the server never hears of it.
    expect(diffAssignments([], [])).toEqual({
      removed: [],
      reassigned: [],
      added: [],
    });
    // ...and while it IS there, it's an insert with nothing to delete.
    expect(diffAssignments([], added).removed).toEqual([]);
  });

  it("says nothing about an untouched roster", () => {
    const rows = [seat("a1", "DRUMS", "u-a", "Alice")];
    expect(diffAssignments(rows, rows)).toEqual({
      removed: [],
      reassigned: [],
      added: [],
    });
  });
});

describe("describeSetChanges", () => {
  const describe_ = (before: SetSnapshot, after: SetSnapshot) =>
    describeSetChanges(before, after, labelFor, nameFor);

  it("says nothing when nothing changed", () => {
    expect(describe_(snapshot(), snapshot())).toEqual([]);
  });

  it("names the people and roles a roster edit touched", () => {
    const before = snapshot({
      assignments: [seat("a1", "DRUMS", "u-a", "Alice"), seat("a2", "BASS", "u-b", "Bob")],
    });
    const after = snapshot({
      assignments: [
        seat("a1", "DRUMS", "u-b", "Bob"), // swapped
        seat(newLocalId(), "KEYS", "u-a", "Alice"), // added
        // a2 dropped
      ],
    });
    expect(describe_(before, after)).toEqual([
      "Drums: Alice → Bob",
      "Removed Bob from Bass",
      "Added Alice on Keys",
    ]);
  });

  it("reports a shape change per role, including a role that appeared", () => {
    const after = snapshot({ capacities: { DRUMS: 1, KEYS: 0, VOCALS: 2, BASS: 1 } });
    expect(describe_(snapshot(), after)).toEqual([
      "Keys slots: 1 → 0",
      "Bass slots: 0 → 1",
    ]);
  });

  it("reports the flags, the MD and the notes in plain words", () => {
    const after = snapshot({
      requiresMD: true,
      isPrivate: true,
      mdUserId: "u-b",
      notes: "Communion Sunday",
      groupChatLeadDays: 7,
    });
    expect(describe_(snapshot(), after)).toEqual([
      "Now requires an MD",
      "Musical director: Bob",
      "Edited the notes",
      "Made the set private",
      "Auto group chat: 7 days before",
    ]);
  });

  it("reports a cleared MD and cleared notes as clears", () => {
    const before = snapshot({ mdUserId: "u-a", notes: "old" });
    expect(describe_(before, snapshot())).toEqual([
      "Cleared the musical director",
      "Cleared the notes",
    ]);
  });

  it("ignores notes that only differ by surrounding whitespace", () => {
    const before = snapshot({ notes: "Same" });
    expect(describe_(before, snapshot({ notes: "  Same  " }))).toEqual([]);
  });

  it("summarizes the setlist the way the history log does", () => {
    const after = snapshot({ songs: [{ title: "Who Else", key: "E" }] });
    expect(describe_(snapshot(), after)).toEqual(['Setlist: added "Who Else" (E)']);
  });

  it("reports guest teams joining, changing and leaving", () => {
    const choir = {
      teamId: "t-choir",
      teamName: "Choir",
      roles: [{ role: "VOCALS", count: 4 }],
    };
    const youth = { teamId: "t-youth", teamName: "Youth", roles: [] };

    expect(describe_(snapshot(), snapshot({ guestTeams: [choir] }))).toEqual([
      "Borrowing from Choir",
    ]);
    expect(
      describe_(
        snapshot({ guestTeams: [choir] }),
        snapshot({ guestTeams: [{ ...choir, roles: [{ role: "VOCALS", count: 6 }] }] })
      )
    ).toEqual(["Changed what Choir lends"]);
    expect(
      describe_(snapshot({ guestTeams: [choir, youth] }), snapshot({ guestTeams: [youth] }))
    ).toEqual(["No longer borrowing from Choir"]);
  });
});
