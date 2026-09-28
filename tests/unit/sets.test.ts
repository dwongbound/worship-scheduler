// Unit tests for the pure set-rules in lib/sets.ts:
//   • selectUpcomingSets — the calendar "Upcoming sets" drawer.
//   • canViewSet /
//     visibleSetsFilter  — private-set visibility (in memory + as a db filter).
//   • coverEligibility   — who may take a swap-requested slot.
//   • resolveSetsWindow  — the GET /api/sets date window.
import { describe, expect, it } from "vitest";
import {
  canViewSet,
  coverEligibility,
  mergeSetWindows,
  missingRanges,
  resolveSetsWindow,
  selectUpcomingSets,
  type CoverEligibilityInput,
  unionRange,
  visibleSetsFilter,
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

describe("mergeSetWindows", () => {
  const set = (id: string, startsAt: string) => ({ id, startsAt });

  it("keeps both windows, in start order", () => {
    const merged = mergeSetWindows(
      [set("b", "2026-10-02T18:00:00Z"), set("a", "2026-10-01T09:00:00Z")],
      [set("c", "2026-10-03T09:00:00Z")]
    );
    expect(merged.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("orders a gap fetched from the PAST into place, not onto the end", () => {
    const merged = mergeSetWindows(
      [set("sep", "2026-09-30T18:00:00Z")],
      [set("aug", "2026-08-02T09:00:00Z")]
    );
    expect(merged.map((s) => s.id)).toEqual(["aug", "sep"]);
  });

  it("lets the incoming copy win, since it is the fresher read", () => {
    // A gap fetch can overlap a day already held — the roster may have changed
    // since, and the new one is the one to keep.
    const merged = mergeSetWindows(
      [{ id: "a", startsAt: "2026-10-01T09:00:00Z", label: "old" }],
      [{ id: "a", startsAt: "2026-10-01T09:00:00Z", label: "new" }]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].label).toBe("new");
  });

  it("is a no-op when the gap came back empty", () => {
    const existing = [set("a", "2026-10-01T09:00:00Z")];
    expect(mergeSetWindows(existing, [])).toEqual(existing);
  });

  it("dedupes within the incoming batch too", () => {
    // Two gaps (one each side) are fetched in parallel and flattened; an
    // overlap between them must not double a set.
    const merged = mergeSetWindows(
      [],
      [set("a", "2026-10-01T09:00:00Z"), set("a", "2026-10-01T09:00:00Z")]
    );
    expect(merged).toHaveLength(1);
  });
});

describe("missingRanges", () => {
  const day = 24 * 60 * 60 * 1000;
  const loaded = { start: 100 * day, end: 200 * day };

  it("asks for everything when nothing is held yet", () => {
    const wanted = { start: 0, end: 10 * day };
    expect(missingRanges(null, wanted)).toEqual([wanted]);
  });

  it("asks for nothing when the window is already covered", () => {
    expect(missingRanges(loaded, { start: 120 * day, end: 180 * day })).toEqual(
      []
    );
    // Exactly the same window — the common case, every re-render.
    expect(missingRanges(loaded, loaded)).toEqual([]);
  });

  it("asks only for the new days when the window grows forward", () => {
    expect(missingRanges(loaded, { start: 100 * day, end: 230 * day })).toEqual([
      { start: 200 * day, end: 230 * day },
    ]);
  });

  it("asks only for the new days when it grows backward", () => {
    expect(missingRanges(loaded, { start: 80 * day, end: 200 * day })).toEqual([
      { start: 80 * day, end: 100 * day },
    ]);
  });

  it("returns both ends when the window grew each way at once", () => {
    expect(missingRanges(loaded, { start: 90 * day, end: 210 * day })).toEqual([
      { start: 90 * day, end: 100 * day },
      { start: 200 * day, end: 210 * day },
    ]);
  });

  it("never returns an empty or backwards span", () => {
    // The boundary case: the window ends exactly where the loaded one does.
    expect(missingRanges(loaded, { start: 150 * day, end: 200 * day })).toEqual(
      []
    );
    for (const gap of missingRanges(loaded, { start: 90 * day, end: 210 * day })) {
      expect(gap.end).toBeGreaterThan(gap.start);
    }
  });

  it("asks for the whole window when it doesn't overlap what's held", () => {
    // Not reachable from the calendar (its window only grows outward), but the
    // honest answer to "what don't I have" is "all of it" — never a gap
    // spanning the void between them.
    const far = { start: 900 * day, end: 950 * day };
    expect(missingRanges(loaded, far)).toEqual([far]);
    const behind = { start: 0, end: 50 * day };
    expect(missingRanges(loaded, behind)).toEqual([behind]);
  });
});

describe("unionRange", () => {
  it("covers both spans", () => {
    expect(unionRange({ start: 5, end: 10 }, { start: 8, end: 20 })).toEqual({
      start: 5,
      end: 20,
    });
  });

  it("keeps the older edge when the window has slid forward", () => {
    // At the 400-day cap the window's start moves up, but sets fetched before
    // it moved are still held — the record has to say so or they'd be re-asked.
    expect(unionRange({ start: 0, end: 100 }, { start: 40, end: 140 })).toEqual({
      start: 0,
      end: 140,
    });
  });
});
