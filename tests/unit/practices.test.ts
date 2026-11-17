import { describe, it, expect, vi } from "vitest";
import {
  MAX_PRACTICES_PER_SET,
  MAX_PRACTICE_MINUTES,
  MIN_PRACTICE_MINUTES,
  describeTemplatePractice,
  practiceCountBadge,
  practiceDates,
  practiceMinutes,
  practiceFreeBusy,
  practiceWeekStart,
  practicesForSet,
  validateSetPractice,
  validateTemplatePractices,
} from "@/lib/practices";
import { DAY_LABELS } from "@/lib/constants";
import { minutesToShortTimeLabel } from "@/lib/dates";

// Nov 8 2026 is a Sunday; the generator builds set times in local time.
const SUNDAY_10AM = new Date(2026, 10, 8, 10, 0);
const WED = 3;
const SAT = 6;
const SUN = 0;

const at = (h: number, m = 0) => h * 60 + m;
const wed7to9 = { dayOfWeek: WED, startMinute: at(19), endMinute: at(21) };

describe("practiceWeekStart", () => {
  it("is the Monday of the set's week", () => {
    const monday = practiceWeekStart(SUNDAY_10AM);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(2); // Mon Nov 2
    expect(monday.getHours()).toBe(0);
  });

  it("treats Sunday as the END of its week, not the start", () => {
    // The whole point: under Mon–Sun, a Wednesday practice falls BEFORE a
    // Sunday service. Read Sunday as day one and it would land after it.
    const monday = practiceWeekStart(SUNDAY_10AM);
    expect(monday.getTime()).toBeLessThan(SUNDAY_10AM.getTime());
  });

  it("is the same Monday for every day of one week", () => {
    const days = [2, 3, 4, 5, 6, 7, 8].map((d) =>
      practiceWeekStart(new Date(2026, 10, d, 12, 0)).getDate()
    );
    expect(days).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it("steps back a month when the week does", () => {
    const monday = practiceWeekStart(new Date(2026, 11, 3, 19, 0)); // Thu Dec 3
    expect(monday.getMonth()).toBe(10); // November
    expect(monday.getDate()).toBe(30);
  });
});

describe("practiceDates", () => {
  it("puts a Wednesday practice before its Sunday set", () => {
    const { startsAt, endsAt } = practiceDates(SUNDAY_10AM, wed7to9);
    expect(startsAt.getDay()).toBe(WED);
    expect(startsAt.getDate()).toBe(4); // Wed Nov 4, three days before
    expect(startsAt.getHours()).toBe(19);
    expect(endsAt.getHours()).toBe(21);
    expect(startsAt.getTime()).toBeLessThan(SUNDAY_10AM.getTime());
  });

  it("puts a Saturday practice the day before a Sunday set", () => {
    const { startsAt } = practiceDates(SUNDAY_10AM, {
      dayOfWeek: SAT,
      startMinute: at(9),
      endMinute: at(10, 30),
    });
    expect(startsAt.getDate()).toBe(7);
    expect(startsAt.getTime()).toBeLessThan(SUNDAY_10AM.getTime());
  });

  it("puts a Sunday practice on the set's own day", () => {
    const { startsAt } = practiceDates(SUNDAY_10AM, {
      dayOfWeek: SUN,
      startMinute: at(8),
      endMinute: at(9, 30),
    });
    expect(startsAt.getDate()).toBe(8);
    expect(startsAt.getHours()).toBe(8);
  });

  it("can land after its set when the weekday is later in the week", () => {
    // A Wednesday set with a Friday practice: still the same Mon–Sun week, so
    // the practice is after the set. Legitimate, just unusual.
    const wedSet = new Date(2026, 10, 4, 19, 0);
    const { startsAt } = practiceDates(wedSet, {
      dayOfWeek: 5,
      startMinute: at(19),
      endMinute: at(21),
    });
    expect(startsAt.getDate()).toBe(6);
    expect(startsAt.getTime()).toBeGreaterThan(wedSet.getTime());
  });

  it("keeps the wall-clock time the admin typed across a DST change", () => {
    // DST ends Nov 1 2026 in the US, so Sun Nov 1's Mon–Sun week starts Oct 26
    // — before the change. A 7 PM practice must still read 19:00 locally.
    const { startsAt, endsAt } = practiceDates(new Date(2026, 10, 1, 10, 0), wed7to9);
    expect(startsAt.getMonth()).toBe(9); // October
    expect(startsAt.getDate()).toBe(28);
    expect(startsAt.getHours()).toBe(19);
    expect(endsAt.getHours()).toBe(21);
  });

  it("carries an end of midnight into the next day", () => {
    const { startsAt, endsAt } = practiceDates(SUNDAY_10AM, {
      dayOfWeek: WED,
      startMinute: at(22),
      endMinute: 24 * 60,
    });
    expect(startsAt.getDate()).toBe(4);
    expect(endsAt.getDate()).toBe(5);
    expect(endsAt.getHours()).toBe(0);
  });
});

describe("practiceMinutes", () => {
  it("is the span between the two instants", () => {
    expect(practiceMinutes(practiceDates(SUNDAY_10AM, wed7to9))).toBe(120);
  });
});

describe("practicesForSet", () => {
  it("resolves a template's weekdays against one set, in the order they happen", () => {
    const out = practicesForSet(SUNDAY_10AM, [
      { dayOfWeek: SAT, startMinute: at(9), endMinute: at(10, 30) },
      wed7to9,
    ]);
    expect(out.map((p) => p.startsAt.getDate())).toEqual([4, 7]);
    expect(out.map((p) => practiceMinutes(p))).toEqual([120, 90]);
  });

  it("gives an empty list for a template with no practices", () => {
    expect(practicesForSet(SUNDAY_10AM, [])).toEqual([]);
  });
});

describe("validateTemplatePractices", () => {
  it("treats a missing list as no practices", () => {
    expect(validateTemplatePractices(undefined)).toEqual({ practices: [] });
    expect(validateTemplatePractices(null)).toEqual({ practices: [] });
  });

  it("accepts a well-formed list and orders it Mon–Sun", () => {
    const res = validateTemplatePractices([
      { dayOfWeek: SUN, startMinute: at(8), endMinute: at(9, 30) },
      wed7to9,
    ]);
    // Sunday is the week's LAST day, so it sorts after Wednesday.
    expect("practices" in res && res.practices.map((p) => p.dayOfWeek)).toEqual([WED, SUN]);
  });

  it("drops a duplicate rather than refusing the save", () => {
    // Two practices at one instant would be two identical calendar events.
    const res = validateTemplatePractices([wed7to9, { ...wed7to9, endMinute: at(20) }]);
    expect("practices" in res && res.practices).toHaveLength(1);
  });

  it("keeps two practices on one day at different times", () => {
    const res = validateTemplatePractices([
      wed7to9,
      { dayOfWeek: WED, startMinute: at(10), endMinute: at(11) },
    ]);
    expect("practices" in res && res.practices.map((p) => p.startMinute)).toEqual([
      at(10),
      at(19),
    ]);
  });

  it("refuses a weekday outside 0–6", () => {
    expect(validateTemplatePractices([{ ...wed7to9, dayOfWeek: -1 }])).toHaveProperty("error");
    expect(validateTemplatePractices([{ ...wed7to9, dayOfWeek: 7 }])).toHaveProperty("error");
    expect(validateTemplatePractices([{ ...wed7to9, dayOfWeek: 2.5 }])).toHaveProperty("error");
  });

  it("refuses times that aren't minutes of a day", () => {
    expect(validateTemplatePractices([{ ...wed7to9, startMinute: -1 }])).toHaveProperty("error");
    expect(validateTemplatePractices([{ ...wed7to9, startMinute: 1440 }])).toHaveProperty("error");
    expect(validateTemplatePractices([{ ...wed7to9, endMinute: 1441 }])).toHaveProperty("error");
  });

  it("refuses an end that isn't after the start", () => {
    expect(validateTemplatePractices([{ ...wed7to9, endMinute: at(19) }])).toEqual({
      error: "A practice has to end after it starts.",
    });
    expect(validateTemplatePractices([{ ...wed7to9, endMinute: at(18) }])).toHaveProperty("error");
  });

  it("refuses a window shorter or longer than allowed", () => {
    expect(
      validateTemplatePractices([
        { ...wed7to9, endMinute: at(19) + MIN_PRACTICE_MINUTES - 1 },
      ])
    ).toHaveProperty("error");
    expect(
      validateTemplatePractices([
        { dayOfWeek: WED, startMinute: 0, endMinute: MAX_PRACTICE_MINUTES + 1 },
      ])
    ).toHaveProperty("error");
  });

  it("refuses anything that isn't a list of objects", () => {
    expect(validateTemplatePractices("nope")).toHaveProperty("error");
    expect(validateTemplatePractices([null])).toHaveProperty("error");
    expect(validateTemplatePractices([7])).toHaveProperty("error");
  });

  it("refuses more than the cap, counting after duplicates are dropped", () => {
    const many = Array.from({ length: MAX_PRACTICES_PER_SET + 1 }, (_, i) => ({
      dayOfWeek: WED,
      startMinute: i,
      endMinute: i + 60,
    }));
    expect(validateTemplatePractices(many)).toHaveProperty("error");
    // The same practice repeated past the cap is one practice, not an error.
    const dupes = Array.from({ length: MAX_PRACTICES_PER_SET + 5 }, () => ({ ...wed7to9 }));
    expect("practices" in validateTemplatePractices(dupes)).toBe(true);
  });
});

describe("validateSetPractice", () => {
  const start = new Date(2026, 10, 4, 19, 0);
  const end = new Date(2026, 10, 4, 21, 0);

  it("accepts a date object and an ISO string alike", () => {
    expect(validateSetPractice({ startsAt: start, endsAt: end })).toEqual({
      practice: { startsAt: start, endsAt: end },
    });
    const res = validateSetPractice({
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
    });
    expect("practice" in res && res.practice.startsAt.getTime()).toBe(start.getTime());
  });

  it("takes any date at all — the point of an ad-hoc practice", () => {
    // A month after its set, on a weekday no template mentions.
    const far = new Date(2026, 11, 24, 11, 0);
    const res = validateSetPractice({
      startsAt: far,
      endsAt: new Date(2026, 11, 24, 12, 30),
    });
    expect("practice" in res).toBe(true);
  });

  it("refuses an unparseable or missing date on either end", () => {
    expect(validateSetPractice({ endsAt: end })).toHaveProperty("error");
    expect(validateSetPractice({ startsAt: start })).toHaveProperty("error");
    expect(validateSetPractice({ startsAt: "not a date", endsAt: end })).toHaveProperty("error");
    expect(validateSetPractice(null)).toHaveProperty("error");
  });

  it("refuses an end that isn't after the start", () => {
    expect(validateSetPractice({ startsAt: start, endsAt: start })).toHaveProperty("error");
    expect(
      validateSetPractice({ startsAt: end, endsAt: start })
    ).toHaveProperty("error");
  });

  it("refuses a window shorter or longer than allowed", () => {
    expect(
      validateSetPractice({ startsAt: start, endsAt: new Date(2026, 10, 4, 19, 5) })
    ).toHaveProperty("error");
    expect(
      validateSetPractice({ startsAt: start, endsAt: new Date(2026, 10, 5, 19, 1) })
    ).toHaveProperty("error");
  });

  it("names the clash itself rather than leaving it to the unique index", () => {
    const res = validateSetPractice({ startsAt: start, endsAt: end }, [new Date(start)]);
    expect(res).toEqual({ error: "There's already a practice at that time on this set." });
  });

  it("lets a second practice on the same day through at another time", () => {
    const res = validateSetPractice({ startsAt: start, endsAt: end }, [
      new Date(2026, 10, 4, 9, 0),
    ]);
    expect("practice" in res).toBe(true);
  });

  it("refuses one past the cap", () => {
    const existing = Array.from(
      { length: MAX_PRACTICES_PER_SET },
      (_, i) => new Date(2026, 9, 1 + i, 19, 0)
    );
    expect(validateSetPractice({ startsAt: start, endsAt: end }, existing)).toHaveProperty(
      "error"
    );
  });
});

describe("practiceCountBadge", () => {
  it("is null for a set with no practices, so the cell stays a bare time", () => {
    expect(practiceCountBadge(0)).toBeNull();
  });

  it("counts one per practice", () => {
    expect(practiceCountBadge(1)).toBe("+1");
    expect(practiceCountBadge(2)).toBe("+2");
  });
});

describe("describeTemplatePractice", () => {
  it("reads as the admin said it", () => {
    expect(
      describeTemplatePractice(wed7to9, (d) => DAY_LABELS[d], minutesToShortTimeLabel)
    ).toBe("Wednesdays, 7PM–9PM");
  });
});

describe("practiceFreeBusy", () => {
  const practice = {
    id: "p1",
    startsAt: new Date(2026, 10, 4, 19, 0),
    endsAt: new Date(2026, 10, 4, 21, 0),
  };
  // Stand-in for isUserAvailable: a rule blocks the person it names.
  type Rule = { userId: string; label: string };
  const blocks = (userId: string, _w: unknown, rules: Rule[]) =>
    !rules.some((r) => r.userId === userId);

  it("answers per person, free and not", () => {
    const out = practiceFreeBusy(
      [{ userId: "a" }, { userId: "b" }],
      practice,
      [{ userId: "b", label: "Wednesdays" }],
      blocks
    );
    expect(out).toEqual([
      { userId: "a", free: true, blockedBy: [] },
      { userId: "b", free: false, blockedBy: [{ userId: "b", label: "Wednesdays" }] },
    ]);
  });

  it("is one row per person, however many seats they hold", () => {
    const out = practiceFreeBusy(
      [{ userId: "a" }, { userId: "a" }, { userId: "b" }],
      practice,
      [],
      blocks
    );
    expect(out.map((p) => p.userId)).toEqual(["a", "b"]);
  });

  it("names every block that would do it on its own", () => {
    const out = practiceFreeBusy(
      [{ userId: "a" }],
      practice,
      [
        { userId: "a", label: "weekly" },
        { userId: "a", label: "that evening" },
        { userId: "other", label: "not theirs" },
      ],
      blocks
    );
    expect(out[0].free).toBe(false);
    expect(out[0].blockedBy.map((r) => r.label)).toEqual(["weekly", "that evening"]);
  });

  it("hands the window the practice's own span, not a duration it was given", () => {
    const seen: { startsAt: Date; durationMinutes: number }[] = [];
    practiceFreeBusy([{ userId: "a" }], practice, [], (_u, w) => {
      seen.push(w);
      return true;
    });
    expect(seen[0].durationMinutes).toBe(120);
    expect(seen[0].startsAt).toEqual(practice.startsAt);
  });

  it("asks nothing of the rules when the roster is empty", () => {
    const blocksSpy = vi.fn(() => true);
    expect(practiceFreeBusy([], practice, [], blocksSpy)).toEqual([]);
    expect(blocksSpy).not.toHaveBeenCalled();
  });
});
