// Unit tests for lib/setHistory.describeSetHistoryEvent — the descriptor the
// per-set history + Team Activity log render. Guards that every event type is
// handled (incl. the swap-proposed/accepted + approval types) and that the
// pending-approval moments read as such.
import { describe, expect, it } from "vitest";
import {
  ALL_HISTORY_TYPES,
  HISTORY_TYPE_LABELS,
  STATUS_LABELS,
  type SetHistoryEventType,
} from "@/lib/constants";
import { describeSetHistoryEvent } from "@/lib/setHistory";
import type { ApiSetHistoryEvent } from "@/lib/types";

function event(
  type: SetHistoryEventType,
  overrides: Partial<ApiSetHistoryEvent> = {}
): ApiSetHistoryEvent {
  return {
    id: "e1",
    type,
    role: "DRUMS",
    detail: null,
    actor: { id: "a", name: "Alice Admin" },
    targetUser: { id: "t", name: "Tara Target" },
    previousUser: { id: "p", name: "Pat Previous" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("describeSetHistoryEvent", () => {
  it("renders a setlist change from its detail, with no role", () => {
    const d = describeSetHistoryEvent(
      event("SETLIST_CHANGED", {
        role: null,
        detail: 'added "Who Else" (E)',
        actor: { id: "u", name: "Dylan Wong" },
      })
    );
    expect(d.actor).toBe("Dylan Wong");
    expect(d.tokens).toEqual(['added "Who Else" (E)']);
  });

  // The other set-level type, same shape: driven by `detail`, no role.
  it("renders a notes change from its detail, with no role", () => {
    const d = describeSetHistoryEvent(
      event("NOTES_CHANGED", {
        role: null,
        detail: 'added a note: "Bring extra cables"',
        actor: { id: "u", name: "Dylan Wong" },
      })
    );
    expect(d.actor).toBe("Dylan Wong");
    expect(d.tokens).toEqual(['added a note: "Bring extra cables"']);
  });

  it("falls back to a plain phrase when a notes change has no detail", () => {
    // Shouldn't happen — the route only logs when describeNotesChange returns a
    // fragment — but a null detail must still render something readable.
    const d = describeSetHistoryEvent(event("NOTES_CHANGED", { detail: null }));
    expect(d.tokens).toEqual(["changed the notes"]);
  });

  // Exhaustiveness guard: a missing switch case would return undefined here.
  it("returns a non-empty descriptor for every event type", () => {
    for (const type of ALL_HISTORY_TYPES) {
      const d = describeSetHistoryEvent(event(type));
      expect(d, type).toBeTruthy();
      expect(d.actor, type).toBeTruthy();
      expect(d.tokens.length, type).toBeGreaterThan(0);
    }
  });

  it("marks the pending-approval moments as awaiting approval", () => {
    const stringify = (type: SetHistoryEventType) =>
      describeSetHistoryEvent(event(type))
        .tokens.map((t) => (typeof t === "string" ? t : t.name))
        .join(" ");
    expect(stringify("SWAP_TAKEN")).toContain("awaiting approval");
    expect(stringify("SWAP_ACCEPTED")).toContain("awaiting approval");
  });

  it("attributes an admin decision to the actor", () => {
    expect(describeSetHistoryEvent(event("APPROVED")).actor).toBe("Alice Admin");
    expect(describeSetHistoryEvent(event("REJECTED")).actor).toBe("Alice Admin");
  });

  // Everything below guards that the log carries the same detail the Slack
  // notifications do — names on both sides, and the requester's note.

  it("quotes the cover note on a cover request, and omits it when absent", () => {
    expect(
      describeSetHistoryEvent(event("SWAP_REQUESTED", { detail: "Away that week" }))
        .tokens
    ).toEqual(["requested cover for", "Drums", '· "Away that week"']);
    expect(
      describeSetHistoryEvent(event("SWAP_REQUESTED", { detail: null })).tokens
    ).toEqual(["requested cover for", "Drums"]);
  });

  it("names both sides of an approved cover, striking the owner it left", () => {
    expect(describeSetHistoryEvent(event("APPROVED")).tokens).toEqual([
      "approved",
      { name: "Tara Target" },
      "covering for",
      { name: "Pat Previous", struck: true },
      "· Drums",
    ]);
  });

  // A rejected cover goes BACK to its owner, so the taker is the struck chip.
  it("strikes the taker on a rejected cover", () => {
    expect(describeSetHistoryEvent(event("REJECTED")).tokens).toEqual([
      "rejected",
      { name: "Pat Previous", struck: true },
      "covering for",
      { name: "Tara Target" },
      "· Drums",
    ]);
  });

  // A targeted swap's approval row carries no people at all (see the approvals
  // route's historyFor), which is what tells it apart from a cover's.
  it("falls back to swap wording when a decision names nobody", () => {
    const bare = { targetUser: null, previousUser: null };
    expect(describeSetHistoryEvent(event("APPROVED", bare)).tokens).toEqual([
      "approved the swap for",
      "Drums",
    ]);
    expect(describeSetHistoryEvent(event("REJECTED", bare)).tokens).toEqual([
      "rejected the swap for",
      "Drums",
    ]);
  });

  it("names the other party on an accepted swap", () => {
    expect(describeSetHistoryEvent(event("SWAP_ACCEPTED")).tokens).toEqual([
      "accepted a swap with",
      { name: "Pat Previous" },
      "· Drums · awaiting approval",
    ]);
  });
});

describe("history + status label completeness", () => {
  it("has a friendly label for every history type", () => {
    for (const type of ALL_HISTORY_TYPES) {
      expect(HISTORY_TYPE_LABELS[type], type).toBeTruthy();
    }
  });

  it("labels the pending-approval assignment status", () => {
    expect(STATUS_LABELS.PENDING_APPROVAL).toBe("Pending approval");
  });
});
