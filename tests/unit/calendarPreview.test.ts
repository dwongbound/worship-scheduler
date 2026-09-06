// Unit tests for the calendar's Preview Mode helpers (lib/calendarPreview.ts):
// matching a real set back to the recurring set it came from, the checkbox
// rows that match drives, and turning real sets into the review workspace's
// staged shape.
import { describe, expect, it } from "vitest";
import {
  OTHER_SET_TYPE,
  buildPreviewPlan,
  describePreviewSaves,
  previewCandidates,
  previewSaves,
  previewSetTypes,
  setTypeOf,
  toStagedSet,
} from "@/lib/calendarPreview";
import type { ApiSet, ApiSetTemplate, StagedSet } from "@/lib/types";

// Everything is read in a fixed zone so the weekday/minute match is the app's,
// not the machine running the tests.
const TZ = "America/Los_Angeles";

const sundayTeam = { id: "team-sun", name: "Sunday Team" };
const prayerTeam = { id: "team-pray", name: "Prayer Room Team" };

// Sundays 9:00 AM on the Sunday Team.
const sundayTemplate: ApiSetTemplate = {
  id: "tpl-sunday",
  label: "Sunday Service",
  dayOfWeek: 0,
  startMinute: 9 * 60,
  durationMinutes: 90,
  requiresMD: false,
  groupChatLeadDays: null,
  slotCapacities: null,
  teamId: sundayTeam.id,
  team: sundayTeam,
};

// Tuesdays 7:00 PM on the Prayer Room Team.
const prayerTemplate: ApiSetTemplate = {
  id: "tpl-prayer",
  label: "Prayer: Tuesday Evening",
  dayOfWeek: 2,
  startMinute: 19 * 60,
  durationMinutes: 60,
  requiresMD: false,
  groupChatLeadDays: null,
  slotCapacities: null,
  teamId: prayerTeam.id,
  team: prayerTeam,
};

const templates = [sundayTemplate, prayerTemplate];

// A minimal calendar set. `startsAt` is given with an explicit -08:00 offset so
// the zoned weekday/minute are unambiguous whatever TZ the test host is in.
function apiSet(over: Partial<ApiSet> & { startsAt: string }): ApiSet {
  return {
    id: over.id ?? `set-${over.startsAt}`,
    label: "Sunday Service",
    durationMinutes: 90,
    notes: null,
    requiresMD: false,
    isPrivate: false,
    mdUserId: null,
    slotCapacities: null,
    teamId: sundayTeam.id,
    team: sundayTeam,
    org: { id: "org-1", name: "Church" },
    assignments: [],
    ...over,
  };
}

// Sun Jan 4 2026, 9:00 AM Pacific.
const SUNDAY = "2026-01-04T09:00:00-08:00";
// Tue Jan 6 2026, 7:00 PM Pacific.
const TUESDAY = "2026-01-06T19:00:00-08:00";

describe("setTypeOf", () => {
  it("matches a set to the recurring set with its name, team, day and time", () => {
    expect(setTypeOf(apiSet({ startsAt: SUNDAY }), templates, TZ)).toBe(
      "tpl-sunday"
    );
    expect(
      setTypeOf(
        apiSet({
          startsAt: TUESDAY,
          label: "Prayer: Tuesday Evening",
          teamId: prayerTeam.id,
          team: prayerTeam,
        }),
        templates,
        TZ
      )
    ).toBe("tpl-prayer");
  });

  it("falls back to Other on a different name, team, day or time", () => {
    const other = (over: Partial<ApiSet>) =>
      setTypeOf(apiSet({ startsAt: SUNDAY, ...over }), templates, TZ);

    expect(other({ label: "Christmas Eve" })).toBe(OTHER_SET_TYPE); // name
    expect(other({ teamId: prayerTeam.id, team: prayerTeam })).toBe(
      OTHER_SET_TYPE
    ); // team
    expect(other({ startsAt: "2026-01-05T09:00:00-08:00" })).toBe(
      OTHER_SET_TYPE
    ); // Monday
    expect(other({ startsAt: "2026-01-04T10:30:00-08:00" })).toBe(
      OTHER_SET_TYPE
    ); // wrong time
  });

  it("reads the day and time in the APP's zone, not the runtime's", () => {
    // 6:00 PM Sunday Pacific = 2:00 AM MONDAY in UTC. Judged in London this is
    // not a Sunday-9am set either way, but the point is the zone decides: a
    // Sunday-6pm recurrence only matches when read in Pacific.
    const evening: ApiSetTemplate = {
      ...sundayTemplate,
      id: "tpl-evening",
      startMinute: 18 * 60,
    };
    const set = apiSet({ startsAt: "2026-01-04T18:00:00-08:00" });
    expect(setTypeOf(set, [evening], TZ)).toBe("tpl-evening");
    expect(setTypeOf(set, [evening], "UTC")).toBe(OTHER_SET_TYPE);
  });

  it("treats a label-less set as Other (templates always have a name)", () => {
    expect(
      setTypeOf(apiSet({ startsAt: SUNDAY, label: null }), templates, TZ)
    ).toBe(OTHER_SET_TYPE);
  });
});

describe("previewSetTypes", () => {
  const sets = [
    apiSet({ id: "a", startsAt: SUNDAY }),
    apiSet({ id: "b", startsAt: "2026-01-11T09:00:00-08:00" }), // next Sunday
    apiSet({ id: "c", startsAt: SUNDAY, label: "Private Rehearsal" }),
  ];

  it("lists each recurring set with sets in view, then Other, with counts", () => {
    expect(previewSetTypes(sets, templates, TZ)).toEqual([
      {
        id: "tpl-sunday",
        label: "Sunday Service",
        dayOfWeek: 0,
        startMinute: 9 * 60,
        team: sundayTeam,
        count: 2,
      },
      {
        id: OTHER_SET_TYPE,
        label: "Other",
        dayOfWeek: null,
        startMinute: null,
        team: null,
        count: 1,
      },
    ]);
  });

  it("drops recurring sets with nothing in view — and Other when nothing is left over", () => {
    const rows = previewSetTypes(sets.slice(0, 2), templates, TZ);
    expect(rows.map((r) => r.id)).toEqual(["tpl-sunday"]);
  });

  it("is empty when there are no sets at all", () => {
    expect(previewSetTypes([], templates, TZ)).toEqual([]);
  });
});

describe("toStagedSet", () => {
  it("carries the set's roster, shape and type across", () => {
    const set = apiSet({
      id: "set-1",
      startsAt: SUNDAY,
      requiresMD: true,
      mdUserId: "u1",
      slotCapacities: { KEYS: 2 },
      groupChatLeadDays: 3,
      assignments: [
        {
          id: "a1",
          role: "KEYS",
          status: "CONFIRMED",
          user: { id: "u1", name: "Carol" },
        },
        {
          id: "a2",
          role: "DRUMS",
          status: "PENDING",
          user: { id: "u2", name: "Bob" },
        },
      ],
    });

    expect(toStagedSet(set, templates, TZ)).toEqual({
      stagingId: "set-1",
      startsAt: SUNDAY,
      label: "Sunday Service",
      durationMinutes: 90,
      requiresMD: true,
      mdUserId: "u1",
      slotCapacities: { KEYS: 2 },
      groupChatLeadDays: 3,
      teamId: sundayTeam.id,
      templateId: "tpl-sunday",
      existing: true,
      assignments: [
        { userId: "u1", role: "KEYS", assignmentId: "a1", pendingFromUserId: null },
        { userId: "u2", role: "DRUMS", assignmentId: "a2", pendingFromUserId: null },
      ],
    });
  });

  it("keeps the owner of a seat that's waiting on an approval", () => {
    // Carol asked for cover on keys and Dave took it: the seat shows Dave, but
    // it's Carol's until an admin approves — and Carol may be the set's MD.
    const set = apiSet({
      startsAt: SUNDAY,
      assignments: [
        {
          id: "a1",
          role: "KEYS",
          status: "PENDING_APPROVAL",
          user: { id: "u4", name: "Dave" },
          pendingFromUser: { id: "u1", name: "Carol", isMD: true },
        },
      ],
    });
    expect(toStagedSet(set, templates, TZ).assignments).toEqual([
      { userId: "u4", role: "KEYS", assignmentId: "a1", pendingFromUserId: "u1" },
    ]);
  });

  it("drops borrowed guest-team seats — the card has no column for them", () => {
    const set = apiSet({
      startsAt: SUNDAY,
      assignments: [
        {
          id: "a1",
          role: "KEYS",
          status: "PENDING",
          user: { id: "u1", name: "Carol" },
        },
        {
          id: "a2",
          role: "CHOIR",
          status: "PENDING",
          user: { id: "u3", name: "Guest" },
          guestTeamId: "gt-1",
        },
      ],
    });
    expect(toStagedSet(set, templates, TZ).assignments).toEqual([
      { userId: "u1", role: "KEYS", assignmentId: "a1", pendingFromUserId: null },
    ]);
  });

  it("keeps same-time sets distinct via their real ids", () => {
    const a = toStagedSet(apiSet({ id: "a", startsAt: SUNDAY }), templates, TZ);
    const b = toStagedSet(
      apiSet({ id: "b", startsAt: SUNDAY, label: "Overflow" }),
      templates,
      TZ
    );
    expect(a.startsAt).toBe(b.startsAt);
    expect(a.stagingId).not.toBe(b.stagingId);
  });
});

describe("previewCandidates", () => {
  const now = new Date("2026-01-05T00:00:00-08:00"); // Mon Jan 5

  it("keeps only this org's sets, from now on, in date order", () => {
    const sets = [
      apiSet({ id: "future2", startsAt: "2026-01-11T09:00:00-08:00" }),
      apiSet({ id: "past", startsAt: "2025-12-28T09:00:00-08:00" }),
      apiSet({ id: "future1", startsAt: TUESDAY }),
      apiSet({
        id: "other-org",
        startsAt: TUESDAY,
        org: { id: "org-2", name: "Youth" },
      }),
    ];
    expect(previewCandidates(sets, "org-1", now).map((s) => s.id)).toEqual([
      "future1",
      "future2",
    ]);
  });

  it("drops sets with no org rather than guessing", () => {
    const sets = [apiSet({ id: "orgless", startsAt: TUESDAY, org: undefined })];
    expect(previewCandidates(sets, "org-1", now)).toEqual([]);
  });
});

describe("buildPreviewPlan", () => {
  const sets = [
    apiSet({ id: "a", startsAt: SUNDAY }),
    apiSet({ id: "b", startsAt: SUNDAY, label: "Private Rehearsal" }),
  ];

  it("stages only the picked types", () => {
    const plan = buildPreviewPlan(sets, templates, ["tpl-sunday"], TZ);
    expect(plan.sets.map((s) => s.stagingId)).toEqual(["a"]);
    // Nothing was generated, so nothing was passed over.
    expect(plan.skipped).toBe(0);
  });

  it("stages the leftovers when Other is picked", () => {
    const plan = buildPreviewPlan(sets, templates, [OTHER_SET_TYPE], TZ);
    expect(plan.sets.map((s) => s.stagingId)).toEqual(["b"]);
    // Other is a real tint key, so the card can be coloured like any type.
    expect(plan.sets[0].templateId).toBe(OTHER_SET_TYPE);
  });

  it("stages nothing when nothing is picked", () => {
    expect(buildPreviewPlan(sets, templates, [], TZ).sets).toEqual([]);
  });
});

describe("previewSaves", () => {
  // The preview as it opened: one set with two real seats and an MD.
  const opened: StagedSet[] = [
    {
      stagingId: "set-1",
      startsAt: SUNDAY,
      label: "Sunday Service",
      durationMinutes: 90,
      requiresMD: true,
      mdUserId: "u1",
      slotCapacities: null,
      teamId: sundayTeam.id,
      existing: true,
      assignments: [
        { userId: "u1", role: "KEYS", assignmentId: "a1" },
        { userId: "u2", role: "DRUMS", assignmentId: "a2" },
      ],
    },
  ];

  // `opened` with its roster/MD replaced.
  const edited = (
    assignments: StagedSet["assignments"],
    mdUserId: string | null = "u1"
  ): StagedSet[] => [{ ...opened[0], assignments, mdUserId }];

  it("reports nothing when nothing was touched", () => {
    expect(previewSaves(opened, structuredClone(opened))).toEqual([]);
  });

  it("keeping a seat's id and changing its person is a reassignment", () => {
    const saves = previewSaves(
      opened,
      edited([
        { userId: "u9", role: "KEYS", assignmentId: "a1" },
        { userId: "u2", role: "DRUMS", assignmentId: "a2" },
      ])
    );
    expect(saves).toEqual([
      {
        setId: "set-1",
        ops: {
          removed: [],
          reassigned: [{ id: "a1", userId: "u9" }],
          added: [],
        },
      },
    ]);
  });

  it("a dropped seat is a removal and an id-less seat is an addition", () => {
    const saves = previewSaves(
      opened,
      edited([
        { userId: "u1", role: "KEYS", assignmentId: "a1" },
        // a2 gone; a fresh seat with no row behind it yet
        { userId: "u3", role: "BASS" },
      ])
    );
    expect(saves[0].ops).toEqual({
      removed: ["a2"],
      reassigned: [],
      added: [{ role: "BASS", userId: "u3" }],
    });
  });

  it("carries an MD change, and only when it changed", () => {
    const [changed] = previewSaves(
      opened,
      edited(structuredClone(opened[0].assignments), "u2")
    );
    expect(changed.mdUserId).toBe("u2");
    // An unchanged MD isn't sent at all — the key is absent, not null.
    const rosterOnly = previewSaves(
      opened,
      edited([{ userId: "u1", role: "KEYS", assignmentId: "a1" }])
    );
    expect("mdUserId" in rosterOnly[0]).toBe(false);
  });

  it("clearing the MD is a change, not a no-op", () => {
    const [save] = previewSaves(
      opened,
      edited(structuredClone(opened[0].assignments), null)
    );
    expect(save.mdUserId).toBeNull();
  });

  it("only reports the sets that actually differ", () => {
    const two = [
      opened[0],
      { ...opened[0], stagingId: "set-2", assignments: [] },
    ];
    const after = [
      { ...two[0], assignments: [{ userId: "u1", role: "KEYS", assignmentId: "a1" }] },
      two[1],
    ];
    expect(previewSaves(two, after).map((s) => s.setId)).toEqual(["set-1"]);
  });

  it("never diffs away a guest seat it was never shown", () => {
    // toStagedSet drops borrowed seats, so they're absent from BOTH sides and
    // can't end up in `removed` — the one way a preview save could quietly
    // delete somebody it never rendered.
    const set = apiSet({
      id: "set-1",
      startsAt: SUNDAY,
      assignments: [
        {
          id: "a1",
          role: "KEYS",
          status: "PENDING",
          user: { id: "u1", name: "Carol" },
        },
        {
          id: "guest-seat",
          role: "CHOIR",
          status: "PENDING",
          user: { id: "u9", name: "Guest" },
          guestTeamId: "gt-1",
        },
      ],
    });
    const before = [toStagedSet(set, templates, TZ)];
    const after = [{ ...before[0], assignments: [] }];
    expect(previewSaves(before, after)[0].ops.removed).toEqual(["a1"]);
  });
});

describe("describePreviewSaves", () => {
  it("counts seats and MD changes across sets", () => {
    expect(
      describePreviewSaves([
        {
          setId: "s1",
          ops: { removed: ["a"], reassigned: [{ id: "b", userId: "u" }], added: [] },
          mdUserId: "u",
        },
        {
          setId: "s2",
          ops: { removed: [], reassigned: [], added: [{ role: "KEYS", userId: "u" }] },
        },
      ])
    ).toBe("3 roster changes and 1 MD change across 2 sets");
  });

  it("uses singulars for a lone change", () => {
    expect(
      describePreviewSaves([
        {
          setId: "s1",
          ops: { removed: ["a"], reassigned: [], added: [] },
        },
      ])
    ).toBe("1 roster change across 1 set");
  });
});
