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
    actor: { id: "a", name: "Alice Admin" },
    targetUser: { id: "t", name: "Tara Target" },
    previousUser: { id: "p", name: "Pat Previous" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("describeSetHistoryEvent", () => {
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
