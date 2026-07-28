// Unit tests for the pure set-rules in lib/sets.ts:
//   • selectUpcomingSets — the calendar "Upcoming sets" drawer.
//   • canViewSet         — private-set visibility.
//   • coverEligibility   — who may take a swap-requested slot.
import { describe, expect, it } from "vitest";
import {
  canViewSet,
  coverEligibility,
  selectUpcomingSets,
  type CoverEligibilityInput,
} from "@/lib/sets";
import type { ApiAssignment, ApiSet } from "@/lib/types";
import type { Instrument } from "@/lib/constants";

// ── selectUpcomingSets ─────────────────────────────────────────────────────

// A minimal assignment (only the fields the drawer rule reads).
function assignment(
  userId: string,
  status: ApiAssignment["status"] = "CONFIRMED"
): ApiAssignment {
  return { id: `a-${userId}`, role: "DRUMS", status, user: { id: userId, name: userId } };
}

// A minimal set at a given ISO time with the given assignments.
function set(id: string, startsAt: string, assignments: ApiAssignment[]): ApiSet {
  return {
    id,
    label: id,
    startsAt,
    durationMinutes: 60,
    notes: null,
    requiresMD: false,
    isPrivate: false,
    choirEnabled: false,
    mdUserId: null,
    slotCapacities: null,
    assignments,
  };
}

describe("selectUpcomingSets", () => {
  const NOW = Date.parse("2026-07-15T12:00:00Z");
  const past = set("past", "2026-07-10T09:00:00Z", [assignment("me")]);
  const soon = set("soon", "2026-07-16T09:00:00Z", [assignment("me", "PENDING")]);
  const later = set("later", "2026-07-20T09:00:00Z", [assignment("other")]);

  it("drops past sets and sorts the rest soonest-first", () => {
    const rows = selectUpcomingSets([later, past, soon], "me", {
      scope: "all",
      sortBy: "date",
      now: NOW,
    });
    expect(rows.map((r) => r.set.id)).toEqual(["soon", "later"]);
  });

  it("scope 'all' includes sets the viewer isn't on (with empty `mine`)", () => {
    const rows = selectUpcomingSets([soon, later], "me", {
      scope: "all",
      sortBy: "date",
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.set.id === "later")!.mine).toEqual([]);
    expect(rows.find((r) => r.set.id === "soon")!.mine).toHaveLength(1);
  });

  it("scope 'mine' keeps only sets the viewer holds a slot on", () => {
    const rows = selectUpcomingSets([soon, later], "me", {
      scope: "mine",
      sortBy: "date",
      now: NOW,
    });
    expect(rows.map((r) => r.set.id)).toEqual(["soon"]);
  });

  it("sort 'unconfirmed' floats the viewer's pending sets above the rest", () => {
    // `later` is sooner-confirmed for someone else; `soon` is the viewer's
    // pending one. Unconfirmed-first must put `soon` first even though both are
    // upcoming and `soon` is already earliest here anyway — so add a set the
    // viewer isn't on that is EARLIER than their pending one to prove the lift.
    const earlyOther = set("early", "2026-07-15T18:00:00Z", [assignment("other")]);
    const rows = selectUpcomingSets([earlyOther, soon, later], "me", {
      scope: "all",
      sortBy: "unconfirmed",
      now: NOW,
    });
    expect(rows[0].set.id).toBe("soon"); // pending-for-me lifted above `early`
  });

  it("no viewer id → every upcoming set, all with empty `mine`", () => {
    const rows = selectUpcomingSets([soon, later], undefined, {
      scope: "all",
      sortBy: "date",
      now: NOW,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.mine.length === 0)).toBe(true);
  });
});

// ── canViewSet ─────────────────────────────────────────────────────────────

describe("canViewSet", () => {
  const viewer = { userId: "u1", isOrgAdmin: false };
  const admin = { userId: "u9", isOrgAdmin: true };

  it("public sets are visible to anyone", () => {
    expect(canViewSet({ isPrivate: false, assignedUserIds: [] }, viewer)).toBe(true);
  });

  it("private sets are visible to their assigned people", () => {
    expect(
      canViewSet({ isPrivate: true, assignedUserIds: ["u1"] }, viewer)
    ).toBe(true);
  });

  it("private sets are visible to org admins even when unassigned", () => {
    expect(canViewSet({ isPrivate: true, assignedUserIds: [] }, admin)).toBe(true);
  });

  it("private sets are hidden from everyone else", () => {
    expect(
      canViewSet({ isPrivate: true, assignedUserIds: ["someone-else"] }, viewer)
    ).toBe(false);
  });
});

// ── coverEligibility ───────────────────────────────────────────────────────

describe("coverEligibility", () => {
  // A viewer who is fully eligible — each test overrides one fact to fail.
  const base: CoverEligibilityInput = {
    viewerId: "kate",
    ownerId: "bob",
    assignmentStatus: "SWAP_REQUESTED",
    viewerInstruments: ["DRUMS"] as Instrument[],
    role: "DRUMS",
    viewerOrgIds: ["org1"],
    setOrgId: "org1",
    setTeamId: "sunday",
    viewerOnTeam: true,
    alreadyInRole: false,
  };

  it("allows an eligible team member on the right instrument", () => {
    expect(coverEligibility(base)).toEqual({ ok: true });
  });

  it("404s a request that is no longer open", () => {
    expect(coverEligibility({ ...base, assignmentStatus: "CONFIRMED" })).toEqual({
      ok: false,
      status: 404,
      error: "Swap request not found",
    });
  });

  it("404s a set in an org the viewer doesn't belong to", () => {
    expect(coverEligibility({ ...base, setOrgId: "other-org" })).toMatchObject({
      status: 404,
    });
  });

  it("403s a team member of the wrong team", () => {
    expect(coverEligibility({ ...base, viewerOnTeam: false })).toEqual({
      ok: false,
      status: 403,
      error: "This cover is for another team",
    });
  });

  it("a team-less set stays open to the whole org", () => {
    expect(
      coverEligibility({ ...base, setTeamId: null, viewerOnTeam: false })
    ).toEqual({ ok: true });
  });

  it("400s taking your own swap", () => {
    expect(coverEligibility({ ...base, ownerId: "kate" })).toMatchObject({
      status: 400,
      error: "Cannot take your own swap",
    });
  });

  it("400s covering an instrument you don't play", () => {
    expect(
      coverEligibility({ ...base, viewerInstruments: ["VOCALS"] as Instrument[] })
    ).toMatchObject({ status: 400, error: "You don't play this instrument" });
  });

  it("400s doubling up on a role you already hold on the set", () => {
    expect(coverEligibility({ ...base, alreadyInRole: true })).toMatchObject({
      status: 400,
      error: "You already play this role on this set",
    });
  });

  it("checks org/existence before team (a cross-org row 404s, never 403s)", () => {
    expect(
      coverEligibility({ ...base, setOrgId: "other-org", viewerOnTeam: false })
    ).toMatchObject({ status: 404 });
  });
});
