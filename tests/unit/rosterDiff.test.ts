// The pure half of a roster save: reading a seat-keyed diff as the final
// roster it means. The 400 these cover is real — a guest-team seat Preview Mode
// never showed, seated again in the role its holder already had.
import { describe, expect, it } from "vitest";
import { collapseByPersonRole } from "@/lib/rosterDiff";

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
    expect(out.reassigned).toHaveLength(2);
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
    expect(out.reassigned).toHaveLength(3);
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
