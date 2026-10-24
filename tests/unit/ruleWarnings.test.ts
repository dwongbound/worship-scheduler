import { describe, expect, it } from "vitest";
import {
  describeSeatWarning,
  ruleWarnings,
  seatKey,
  warningTierLabel,
  type WarningSet,
} from "@/lib/ruleWarnings";
import type { RuleNames, SchedulingRule } from "@/lib/schedulingRules";

const names: RuleNames = {
  team: (id) => `team:${id}`,
  user: (id) => id,
  role: (key) => key,
  template: (id) => id,
  set: (id) => id,
};

let n = 0;
const rule = (
  params: SchedulingRule["params"],
  extra: Partial<SchedulingRule> = {}
): SchedulingRule => ({
  id: `r${++n}`,
  tier: "REQUIRED",
  enabled: true,
  params,
  ...extra,
});

const set = (
  key: string,
  startsAt: string,
  seats: { userId: string; role: string }[],
  extra: Partial<WarningSet> = {}
): WarningSet => ({
  key,
  setId: key,
  startsAt: new Date(startsAt),
  teamId: null,
  templateId: null,
  seats,
  ...extra,
});

const marked = (w: ReturnType<typeof ruleWarnings>) =>
  [...w.bySeat.keys()].sort();

describe("ruleWarnings", () => {
  it("marks nothing when there are no rules", () => {
    const w = ruleWarnings(
      [set("a", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }])],
      []
    );
    expect(w.total).toBe(0);
    expect(w.bySet.size).toBe(0);
  });

  it("ignores a rule that is switched off", () => {
    const w = ruleWarnings(
      [
        set("a", "2026-11-01T10:00:00Z", [
          { userId: "amy", role: "KEYS" },
          { userId: "bo", role: "BASS" },
        ]),
      ],
      [
        rule(
          { kind: "TOGETHER", userIds: ["amy", "bo"], mode: "NEVER" },
          { enabled: false }
        ),
      ]
    );
    expect(w.total).toBe(0);
  });

  describe("together", () => {
    it("marks both when a never-pair share a set", () => {
      const w = ruleWarnings(
        [
          set("a", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "bo", role: "BASS" },
            { userId: "cy", role: "DRUMS" },
          ]),
        ],
        [rule({ kind: "TOGETHER", userIds: ["amy", "bo"], mode: "NEVER" })]
      );
      expect(marked(w)).toEqual([seatKey("a", "amy", "KEYS"), seatKey("a", "bo", "BASS")]);
      expect(w.bySet.get("a")).toBe(2);
    });

    it("marks the lone one of an always-pair", () => {
      const w = ruleWarnings(
        [set("a", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }])],
        [rule({ kind: "TOGETHER", userIds: ["amy", "bo"], mode: "ALWAYS" })]
      );
      expect(marked(w)).toEqual([seatKey("a", "amy", "KEYS")]);
    });

    it("leaves an always-pair alone when both are on", () => {
      const w = ruleWarnings(
        [
          set("a", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "bo", role: "BASS" },
          ]),
        ],
        [rule({ kind: "TOGETHER", userIds: ["amy", "bo"], mode: "ALWAYS" })]
      );
      expect(w.total).toBe(0);
    });

    it("only governs its own team's sets", () => {
      const w = ruleWarnings(
        [
          set(
            "a",
            "2026-11-01T10:00:00Z",
            [
              { userId: "amy", role: "KEYS" },
              { userId: "bo", role: "BASS" },
            ],
            { teamId: "youth" }
          ),
        ],
        [
          rule(
            { kind: "TOGETHER", userIds: ["amy", "bo"], mode: "NEVER" },
            { teamId: "sunday" }
          ),
        ]
      );
      expect(w.total).toBe(0);
    });
  });

  describe("limit", () => {
    const month = [
      set("s1", "2026-11-01T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
      set("s2", "2026-11-08T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
      set("s3", "2026-11-15T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
    ];

    it("marks only the sets past the cap, in date order", () => {
      const w = ruleWarnings(month, [
        rule({ kind: "LIMIT", userId: "amy", max: 2, period: "MONTH" }),
      ]);
      expect(marked(w)).toEqual([seatKey("s3", "amy", "KEYS")]);
    });

    it("counts two roles on one set as one booking", () => {
      // Vocals + acoustic guitar is a pair one person may hold, so the only
      // thing that could mark these seats is the cap — and one set is one set
      // however many roles it hands out.
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T18:00:00Z", [
            { userId: "amy", role: "VOCALS" },
            { userId: "amy", role: "ACOUSTIC_GUITAR" },
          ]),
        ],
        [rule({ kind: "LIMIT", userId: "amy", max: 1, period: "MONTH" })]
      );
      expect(w.total).toBe(0);
    });

    it("counts bookings outside the plan", () => {
      const w = ruleWarnings(
        [set("s1", "2026-11-15T18:00:00Z", [{ userId: "amy", role: "KEYS" }])],
        [rule({ kind: "LIMIT", userId: "amy", max: 1, period: "MONTH" })],
        {
          bookings: [
            { userId: "amy", startsAt: new Date("2026-11-02T18:00:00Z"), setId: "old" },
          ],
        }
      );
      expect(marked(w)).toEqual([seatKey("s1", "amy", "KEYS")]);
    });

    it("does not count a booking on a set the plan already holds", () => {
      // Preview Mode stages sets that are already in the db, so the baseline's
      // bookings and the staged seats are the same thing seen twice.
      const w = ruleWarnings(
        [set("s1", "2026-11-15T18:00:00Z", [{ userId: "amy", role: "KEYS" }])],
        [rule({ kind: "LIMIT", userId: "amy", max: 1, period: "MONTH" })],
        {
          bookings: [
            { userId: "amy", startsAt: new Date("2026-11-15T18:00:00Z"), setId: "s1" },
          ],
        }
      );
      expect(w.total).toBe(0);
    });

    it("caps everyone separately when the rule names nobody", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T18:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "bo", role: "BASS" },
          ]),
          set("s2", "2026-11-08T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
        ],
        [rule({ kind: "LIMIT", userId: null, max: 1, period: "MONTH" })]
      );
      expect(marked(w)).toEqual([seatKey("s2", "amy", "KEYS")]);
    });

    it("counts per week when the period is a week", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-03T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          set("s2", "2026-11-05T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          // The following Monday: a new week, so it starts over.
          set("s3", "2026-11-09T18:00:00Z", [{ userId: "amy", role: "KEYS" }]),
        ],
        [rule({ kind: "LIMIT", userId: "amy", max: 1, period: "WEEK" })]
      );
      expect(marked(w)).toEqual([seatKey("s2", "amy", "KEYS")]);
    });
  });

  describe("same player", () => {
    it("marks both seats when two named sets differ", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          set("s2", "2026-11-01T18:00:00Z", [{ userId: "bo", role: "KEYS" }]),
        ],
        [
          rule({
            kind: "SAME_PLAYER",
            role: "KEYS",
            scope: "ONCE",
            setIds: ["s1", "s2"],
          }),
        ]
      );
      expect(marked(w)).toEqual([seatKey("s1", "amy", "KEYS"), seatKey("s2", "bo", "KEYS")]);
    });

    it("says nothing when one of the pair isn't in the plan", () => {
      const w = ruleWarnings(
        [set("s1", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }])],
        [
          rule({
            kind: "SAME_PLAYER",
            role: "KEYS",
            scope: "ONCE",
            setIds: ["s1", "elsewhere"],
          }),
        ]
      );
      expect(w.total).toBe(0);
    });

    it("says nothing when one side's role is still open", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          set("s2", "2026-11-01T18:00:00Z", []),
        ],
        [
          rule({
            kind: "SAME_PLAYER",
            role: "KEYS",
            scope: "ONCE",
            setIds: ["s1", "s2"],
          }),
        ]
      );
      expect(w.total).toBe(0);
    });

    it("pairs weekly templates up within each week", () => {
      const r = rule({
        kind: "SAME_PLAYER",
        role: "KEYS",
        scope: "WEEKLY",
        templateIds: ["sun", "wed"],
      });
      const sets = [
        // Week of Mon Nov 2: same player, fine.
        set("w1sun", "2026-11-08T18:00:00Z", [{ userId: "amy", role: "KEYS" }], {
          templateId: "sun",
        }),
        set("w1wed", "2026-11-04T18:00:00Z", [{ userId: "amy", role: "KEYS" }], {
          templateId: "wed",
        }),
        // Week of Mon Nov 9: different people.
        set("w2sun", "2026-11-15T18:00:00Z", [{ userId: "amy", role: "KEYS" }], {
          templateId: "sun",
        }),
        set("w2wed", "2026-11-11T18:00:00Z", [{ userId: "bo", role: "KEYS" }], {
          templateId: "wed",
        }),
      ];
      expect(marked(ruleWarnings(sets, [r]))).toEqual(
        [seatKey("w2sun", "amy", "KEYS"), seatKey("w2wed", "bo", "KEYS")].sort()
      );
    });
  });

  describe("role behaviour", () => {
    it("marks acoustic guitar held by nobody's host, by built-in default", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "ACOUSTIC_GUITAR" },
          ]),
        ],
        []
      );
      expect(marked(w)).toEqual([seatKey("s1", "amy", "ACOUSTIC_GUITAR")]);
      // No rule wrote that default, so there's nothing to go and change.
      expect(w.bySeat.get(seatKey("s1", "amy", "ACOUSTIC_GUITAR"))![0].ruleId).toBeNull();
    });

    it("leaves it alone when the same person hosts it", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "ACOUSTIC_GUITAR" },
            { userId: "amy", role: "VOCALS" },
          ]),
        ],
        []
      );
      expect(w.total).toBe(0);
    });

    it("a ROLE_HOST rule that is off turns the default off", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "ACOUSTIC_GUITAR" },
          ]),
        ],
        [
          rule(
            {
              kind: "ROLE_HOST",
              role: "ACOUSTIC_GUITAR",
              hostRoles: ["WORSHIP_LEADER"],
            },
            { enabled: false }
          ),
        ]
      );
      expect(w.total).toBe(0);
    });

    it("marks two roles on one set that may not be doubled", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "amy", role: "DRUMS" },
          ]),
        ],
        []
      );
      expect(marked(w)).toEqual(
        [seatKey("s1", "amy", "KEYS"), seatKey("s1", "amy", "DRUMS")].sort()
      );
    });

    it("allows a pair a MAY_DOUBLE rule permits", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "amy", role: "DRUMS" },
          ]),
        ],
        [rule({ kind: "MAY_DOUBLE", roles: ["KEYS", "DRUMS"] })]
      );
      expect(w.total).toBe(0);
    });
  });

  it("gathers every reason a seat is marked", () => {
    const w = ruleWarnings(
      [
        set("s1", "2026-11-01T10:00:00Z", [
          { userId: "amy", role: "KEYS" },
          { userId: "bo", role: "BASS" },
        ]),
        set("s2", "2026-11-08T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
      ],
      [
        rule({ kind: "TOGETHER", userIds: ["amy", "bo"], mode: "NEVER" }),
        rule({ kind: "LIMIT", userId: "amy", max: 0, period: "MONTH" }),
      ]
    );
    expect(w.bySeat.get(seatKey("s1", "amy", "KEYS"))).toHaveLength(2);
  });

  describe("describeSeatWarning", () => {
    it("reads a rule back as its own sentence", () => {
      const r = rule({ kind: "LIMIT", userId: "amy", max: 2, period: "MONTH" });
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          set("s2", "2026-11-08T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
          set("s3", "2026-11-15T10:00:00Z", [{ userId: "amy", role: "KEYS" }]),
        ],
        [r]
      );
      const [warning] = w.bySeat.get(seatKey("s3", "amy", "KEYS"))!;
      expect(describeSeatWarning(warning, names)).toBe(
        "amy plays at most 2 sets a month"
      );
    });

    it("names both roles for a doubling warning", () => {
      const w = ruleWarnings(
        [
          set("s1", "2026-11-01T10:00:00Z", [
            { userId: "amy", role: "KEYS" },
            { userId: "amy", role: "DRUMS" },
          ]),
        ],
        []
      );
      const [warning] = w.bySeat.get(seatKey("s1", "amy", "KEYS"))!;
      expect(describeSeatWarning(warning, names)).toBe(
        "KEYS and DRUMS aren't played by the same person on one set"
      );
    });
  });

  it("labels the tiers", () => {
    expect(warningTierLabel("REQUIRED")).toBe("Required");
    expect(warningTierLabel("PREFERENCE")).toBe("Preference");
  });
});
