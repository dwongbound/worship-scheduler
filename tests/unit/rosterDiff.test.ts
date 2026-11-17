// The pure half of a roster save: reading a seat-keyed diff as the final
// roster it means. The 400 these cover is real — a guest-team seat Preview Mode
// never showed, seated again in the role its holder already had.
import { describe, expect, it } from "vitest";
import { collapseByPersonRole, rosterSaveError } from "@/lib/rosterDiff";

const seat = (id: string, userId: string, role: string) => ({ id, userId, role });

const ops = (o: Partial<Parameters<typeof collapseByPersonRole>[0]> = {}) => ({
  removed: [],
  reassigned: [],
  added: [],
  ...o,
});

describe("collapseByPersonRole", () => {
  it("passes an ordinary diff through untouched", () => {
    const out = collapseByPersonRole(
      ops({ removed: ["s1"], added: [{ role: "KEYS", userId: "bo" }] }),
      [seat("s1", "amy", "KEYS")]
    );
    expect(out.removed).toEqual(["s1"]);
    expect(out.added).toEqual([{ role: "KEYS", userId: "bo" }]);
    expect(out.collapsedSeatIds).toEqual([]);
    expect(out.droppedAdded).toEqual([]);
  });

  it("drops an addition for someone already in that role", () => {
    // The whole bug: amy holds SOUND as a guest-team seat, which the preview
    // never showed, so it proposed her for SOUND again.
    const out = collapseByPersonRole(
      ops({ added: [{ role: "SOUND", userId: "amy" }] }),
      [seat("guest1", "amy", "SOUND")]
    );
    expect(out.added).toEqual([]);
    expect(out.droppedAdded).toEqual([{ role: "SOUND", userId: "amy" }]);
    // Nothing is deleted either — her existing seat keeps its status.
    expect(out.removed).toEqual([]);
  });

  it("keeps an addition in a DIFFERENT role for the same person", () => {
    const out = collapseByPersonRole(
      ops({ added: [{ role: "KEYS", userId: "amy" }] }),
      [seat("guest1", "amy", "SOUND")]
    );
    expect(out.added).toEqual([{ role: "KEYS", userId: "amy" }]);
  });

  it("keeps an addition whose duplicate is being removed", () => {
    const out = collapseByPersonRole(
      ops({
        removed: ["s1"],
        added: [{ role: "KEYS", userId: "amy" }],
      }),
      [seat("s1", "amy", "KEYS")]
    );
    expect(out.added).toEqual([{ role: "KEYS", userId: "amy" }]);
  });

  it("collapses two identical additions into one seat", () => {
    const out = collapseByPersonRole(
      ops({
        added: [
          { role: "VOCALS", userId: "amy" },
          { role: "VOCALS", userId: "amy" },
        ],
      }),
      []
    );
    expect(out.added).toHaveLength(1);
    expect(out.droppedAdded).toHaveLength(1);
  });

  it("saves a two-person trade within one role", () => {
    const out = collapseByPersonRole(
      ops({
        reassigned: [
          { id: "s1", userId: "bo" },
          { id: "s2", userId: "amy" },
        ],
      }),
      [seat("s1", "amy", "VOCALS"), seat("s2", "bo", "VOCALS")]
    );
    // Nobody is dropped — but the pair is a cycle, so one of the two seats is
    // rebuilt rather than updated in place. See the replay tests below.
    expect(out.reassigned.length + out.rebuilt.length).toBe(2);
    expect(out.collapsedSeatIds).toEqual([]);
  });

  it("saves a three-way rotation within one role", () => {
    const out = collapseByPersonRole(
      ops({
        reassigned: [
          { id: "s1", userId: "bo" },
          { id: "s2", userId: "cy" },
          { id: "s3", userId: "amy" },
        ],
      }),
      [
        seat("s1", "amy", "VOCALS"),
        seat("s2", "bo", "VOCALS"),
        seat("s3", "cy", "VOCALS"),
      ]
    );
    expect(out.reassigned.length + out.rebuilt.length).toBe(3);
    expect(out.rebuilt).toHaveLength(1);
    expect(out.collapsedSeatIds).toEqual([]);
  });

  it("drops the spare seat when a reassignment lands on an existing holder", () => {
    // Seat s2 is being handed to amy, who already holds VOCALS on s1 and is
    // staying there. One person, one seat: s2 goes.
    const out = collapseByPersonRole(
      ops({ reassigned: [{ id: "s2", userId: "amy" }] }),
      [seat("s1", "amy", "VOCALS"), seat("s2", "bo", "VOCALS")]
    );
    expect(out.reassigned).toEqual([]);
    expect(out.collapsedSeatIds).toEqual(["s2"]);
    // The collapsed seat is deleted, so bo doesn't quietly keep it.
    expect(out.removed).toEqual(["s2"]);
  });

  it("orders the writes deletes-then-reassignments-then-insertions", () => {
    // Nothing asserts an order here directly — what matters is that every
    // collapsed seat is in `removed`, which the caller writes first, so no
    // moment inside the transaction holds one person in a role twice.
    const out = collapseByPersonRole(
      ops({
        removed: ["s0"],
        reassigned: [{ id: "s2", userId: "amy" }],
        added: [{ role: "SOUND", userId: "amy" }],
      }),
      [
        seat("s0", "cy", "DRUMS"),
        seat("s1", "amy", "VOCALS"),
        seat("s2", "bo", "VOCALS"),
        seat("guest1", "amy", "SOUND"),
      ]
    );
    expect(out.removed).toEqual(["s0", "s2"]);
    expect(out.added).toEqual([]);
  });

  it("passes an unknown seat id through for the caller to reject", () => {
    const out = collapseByPersonRole(
      ops({ reassigned: [{ id: "nope", userId: "amy" }] }),
      [seat("s1", "amy", "VOCALS")]
    );
    expect(out.reassigned).toEqual([{ id: "nope", userId: "amy" }]);
  });

  it("treats a guest seat and an ordinary one as the same (person, role)", () => {
    // The db's unique key is [setId, userId, role] — which team lent the seat
    // makes no difference to it.
    const out = collapseByPersonRole(
      ops({ added: [{ role: "CHOIR", userId: "amy", guestTeamId: "g1" }] }),
      [seat("s1", "amy", "CHOIR")]
    );
    expect(out.added).toEqual([]);
  });
});

// A shuffle INSIDE one multi-seat role (Audio - Support 4/4, Vox 2/2, Electric
// Guitar 2/2) is the other way the save 400'd: every seat keeps its old
// occupant until its own update runs, so a rotation has no seat free to move
// first. Replaying the writes in order is the only honest check — the bug was
// never in the final roster, it was halfway through the transaction.
const replay = (
  out: ReturnType<typeof collapseByPersonRole>,
  roster: { id: string; userId: string; role: string }[]
) => {
  const live = new Map(roster.map((s) => [s.id, { ...s }]));
  const assertUnique = (stage: string) => {
    const keys = [...live.values()].map((s) => `${s.userId}|${s.role}`);
    expect(new Set(keys).size, `${stage}: ${keys.join(", ")}`).toBe(keys.length);
  };
  for (const id of out.removed) live.delete(id);
  for (const b of out.rebuilt) live.delete(b.seatId);
  assertUnique("after the deletes");
  for (const r of out.reassigned) {
    live.get(r.id)!.userId = r.userId;
    assertUnique(`after updating ${r.id}`);
  }
  for (const b of out.rebuilt) {
    live.set(`rebuilt-${b.seatId}`, {
      id: `rebuilt-${b.seatId}`,
      userId: b.userId,
      role: b.role,
    });
    assertUnique(`after rebuilding ${b.seatId}`);
  }
  for (const [i, a] of out.added.entries()) {
    live.set(`new-${i}`, { id: `new-${i}`, userId: a.userId, role: a.role });
    assertUnique(`after inserting ${a.userId}`);
  }
  return [...live.values()];
};

describe("shuffles inside one multi-seat role", () => {
  it("rotates four seats without ever holding a person twice", () => {
    const roster = [
      seat("s1", "amy", "SUPPORT"),
      seat("s2", "bo", "SUPPORT"),
      seat("s3", "cy", "SUPPORT"),
      seat("s4", "di", "SUPPORT"),
    ];
    const out = collapseByPersonRole(
      ops({
        reassigned: [
          { id: "s1", userId: "bo" },
          { id: "s2", userId: "cy" },
          { id: "s3", userId: "di" },
          { id: "s4", userId: "amy" },
        ],
      }),
      roster
    );
    // One rebuild breaks the cycle, however long the cycle is.
    expect(out.rebuilt).toHaveLength(1);
    const final = replay(out, roster);
    expect(final.map((s) => s.userId).sort()).toEqual(["amy", "bo", "cy", "di"]);
    expect(final.every((s) => s.role === "SUPPORT")).toBe(true);
  });

  it("swaps two seats in one role without a collision", () => {
    const roster = [seat("s1", "amy", "VOCALS"), seat("s2", "bo", "VOCALS")];
    const out = collapseByPersonRole(
      ops({
        reassigned: [
          { id: "s1", userId: "bo" },
          { id: "s2", userId: "amy" },
        ],
      }),
      roster
    );
    expect(out.rebuilt).toHaveLength(1);
    const final = replay(out, roster);
    expect(final.map((s) => s.userId).sort()).toEqual(["amy", "bo"]);
  });

  it("rebuilds a borrowed seat as a borrowed seat", () => {
    const roster = [
      { ...seat("g1", "amy", "VOCALS"), guestTeamId: "choir" },
      { ...seat("g2", "bo", "VOCALS"), guestTeamId: "choir" },
    ];
    const out = collapseByPersonRole(
      ops({
        reassigned: [
          { id: "g1", userId: "bo" },
          { id: "g2", userId: "amy" },
        ],
      }),
      roster
    );
    expect(out.rebuilt[0].guestTeamId).toBe("choir");
  });

  it("needs no rebuild when one seat in the role is free to move first", () => {
    // amy leaves, bo takes her seat: a chain, not a cycle.
    const roster = [seat("s1", "amy", "SUPPORT"), seat("s2", "bo", "SUPPORT")];
    const out = collapseByPersonRole(
      ops({ removed: ["s2"], reassigned: [{ id: "s1", userId: "bo" }] }),
      roster
    );
    expect(out.rebuilt).toEqual([]);
    const final = replay(out, roster);
    expect(final.map((s) => s.userId)).toEqual(["bo"]);
  });

  it("orders a chain of moves so each lands on a free seat", () => {
    // cy takes bo's seat, bo takes amy's, amy leaves: must run bo→amy's seat
    // only after amy's own seat is gone.
    const roster = [
      seat("s1", "amy", "SUPPORT"),
      seat("s2", "bo", "SUPPORT"),
      seat("s3", "cy", "SUPPORT"),
    ];
    const out = collapseByPersonRole(
      ops({
        removed: ["s3"],
        reassigned: [
          { id: "s1", userId: "bo" },
          { id: "s2", userId: "cy" },
        ],
      }),
      roster
    );
    expect(out.rebuilt).toEqual([]);
    const final = replay(out, roster);
    expect(final.map((s) => s.userId).sort()).toEqual(["bo", "cy"]);
  });
});

// Which failure gets which sentence. This was a catch-all once: every write
// error came back as "already in this role", so a transaction that merely ran
// out of time looked like a seat clash and we went looking for one twice.
describe("rosterSaveError", () => {
  it("names a duplicate seat only for the unique constraint", () => {
    const e = rosterSaveError({ code: "P2002" });
    expect(e.status).toBe(400);
    expect(e.error).toMatch(/already in this role/i);
  });

  it("says plainly that nothing was saved for anything else", () => {
    for (const err of [
      { code: "P2028" }, // transaction timed out
      { code: "P1001" }, // couldn't reach the database
      new Error("boom"),
      null,
    ]) {
      const e = rosterSaveError(err);
      expect(e.status).toBe(500);
      expect(e.error).not.toMatch(/already in this role/i);
      expect(e.error).toMatch(/nothing was changed/i);
    }
  });
});
