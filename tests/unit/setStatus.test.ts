// Unit tests for lib/setStatus — the set's overall status (calendar dot +
// filters) derived from its assignments' statuses, including the new
// PENDING_APPROVAL state.
import { describe, expect, it } from "vitest";
import { setStatus } from "@/lib/setStatus";
import type { AssignmentStatus } from "@/lib/constants";

// Build a minimal set with just the assignment statuses setStatus reads.
function set(...statuses: AssignmentStatus[]) {
  return {
    assignments: statuses.map((status) => ({ status })),
  } as Parameters<typeof setStatus>[0];
}

describe("setStatus", () => {
  it("is empty when nobody is assigned", () => {
    expect(setStatus(set())).toBe("empty");
  });

  it("is confirmed when every slot is confirmed", () => {
    expect(setStatus(set("CONFIRMED", "CONFIRMED"))).toBe("confirmed");
  });

  it("is unconfirmed when a slot is pending confirmation", () => {
    expect(setStatus(set("CONFIRMED", "PENDING"))).toBe("unconfirmed");
  });

  it("is unconfirmed when a slot is pending admin approval", () => {
    expect(setStatus(set("CONFIRMED", "PENDING_APPROVAL"))).toBe("unconfirmed");
  });

  it("is cover when any slot is a cover request", () => {
    expect(setStatus(set("CONFIRMED", "SWAP_REQUESTED"))).toBe("cover");
  });

  it("cover outranks a pending-approval slot", () => {
    expect(setStatus(set("PENDING_APPROVAL", "SWAP_REQUESTED"))).toBe("cover");
  });
});
