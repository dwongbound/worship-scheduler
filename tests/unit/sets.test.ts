// Unit tests for the pure set-rules in lib/sets.ts:
//   • selectUpcomingSets — the calendar "Upcoming sets" drawer.
//   • canViewSet /
//     visibleSetsFilter  — private-set visibility (in memory + as a db filter).
//   • coverEligibility   — who may take a swap-requested slot.
//   • resolveSetsWindow  — the GET /api/sets date window.
import { describe, expect, it } from "vitest";
import {
  canViewSet,
  visibleSetsFilter,
  coverEligibility,
  resolveSetsWindow,
  selectUpcomingSets,
  type CoverEligibilityInput,
} from "@/lib/sets";
import type { ApiAssignment, ApiSet } from "@/lib/types";
import {
  SETS_WINDOW_DEFAULT_DAYS,
  SETS_WINDOW_MAX_DAYS,
  type Instrument,
} from "@/lib/constants";

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

// ── visibleSetsFilter ──────────────────────────────────────────────────────

describe("visibleSetsFilter", () => {
  it("ordinary viewers get the three-branch OR (public / mine / org admin)", () => {
    const where = visibleSetsFilter({ userId: "u1", isSuperAdmin: false });
    expect(where).toEqual({
      OR: [
        { isPrivate: false },
        { assignments: { some: { userId: "u1" } } },
        { org: { memberships: { some: { userId: "u1", isAdmin: true } } } },
      ],
    });
  });

  // A super-admin can create a set in an org they only joined as a member (or
  // never joined at all); without this an unstaffed private set would vanish
  // the moment they made it.
  it("super-admins get no filter at all", () => {
    expect(visibleSetsFilter({ userId: "u1", isSuperAdmin: true })).toEqual({});
  });
});

// ── coverEligibility ───────────────────────────────────────────────────────

describe("coverEligibility", () => {
  // A viewer who is fully eligible — each test overrides one fact to fail.
  const base: CoverEligibilityInput = {
    viewerId: "kate",
    ownerId: "bob",
    assignmentStatus: "SWAP_REQUESTED",
    viewerRolesForSet: ["DRUMS"] as Instrument[],
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
      coverEligibility({ ...base, viewerRolesForSet: ["VOCALS"] as Instrument[] })
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

describe("resolveSetsWindow", () => {
  const NOW = new Date(2026, 7, 18, 12, 0); // Aug 18 2026, noon
  const DAY = 24 * 60 * 60 * 1000;
  const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

  it("falls back to the default window when nothing is passed", () => {
    // This is what every existing caller (and the e2e suite) relies on.
    const { start, end } = resolveSetsWindow(null, null, NOW);
    expect(days(start, NOW)).toBe(SETS_WINDOW_DEFAULT_DAYS);
    expect(days(NOW, end)).toBe(SETS_WINDOW_DEFAULT_DAYS);
  });

  it("defaults each side independently", () => {
    const { start, end } = resolveSetsWindow(null, "2026-12-31", NOW);
    expect(days(start, NOW)).toBe(SETS_WINDOW_DEFAULT_DAYS);
    expect(end.getMonth()).toBe(11);
    expect(end.getDate()).toBe(31);
  });

  it("reads the dates as LOCAL days, not UTC", () => {
    // new Date("2026-09-01") is UTC midnight — Aug 31 in a negative-offset TZ.
    // Getting this wrong drops the last day of any requested month.
    const { start, end } = resolveSetsWindow("2026-09-01", "2026-09-30", NOW);
    expect([start.getMonth(), start.getDate()]).toEqual([8, 1]);
    expect([end.getMonth(), end.getDate()]).toEqual([8, 30]);
  });

  it("covers the whole of the `to` day", () => {
    const { end } = resolveSetsWindow("2026-09-01", "2026-09-30", NOW);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it("ignores an unparseable date in favour of that side's default", () => {
    const { start, end } = resolveSetsWindow("not-a-date", "2026-09-30", NOW);
    expect(days(start, NOW)).toBe(SETS_WINDOW_DEFAULT_DAYS);
    expect(end.getMonth()).toBe(8);
  });

  it("clamps an over-wide span from the start", () => {
    const { start, end } = resolveSetsWindow("2026-01-01", "2099-01-01", NOW);
    expect(days(start, end)).toBe(SETS_WINDOW_MAX_DAYS);
  });

  it("recovers from a backwards range instead of returning nothing", () => {
    const { start, end } = resolveSetsWindow("2026-09-30", "2026-09-01", NOW);
    expect(end.getTime()).toBeGreaterThan(start.getTime());
  });
});
