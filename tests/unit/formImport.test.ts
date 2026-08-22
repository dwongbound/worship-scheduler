// The conflicts people type are free text, and a date this parser misses is
// someone getting scheduled on a day they said they were away — so these cases
// are drawn from the real Fall 2026 form export, quirks and all.
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  findColumn,
  isAlreadyCovered,
  parseConflicts,
  parseDelimited,
  parseYmd,
  toRecords,
  ymd,
} from "@/lib/formImport";

// The window the import resolves bare "9/25"-style dates against.
const FALL_2026 = { start: parseYmd("2026-09-01"), end: parseYmd("2026-12-31") };

const days = (answer: string) =>
  parseConflicts(answer, FALL_2026).blocks.map((b) =>
    b.startYmd === b.endYmd ? b.startYmd : `${b.startYmd}→${b.endYmd}`
  );

describe("parseConflicts", () => {
  it("reads a comma-separated list", () => {
    expect(days("9/25 Large Group, 10/9 Large Group")).toEqual([
      "2026-09-25",
      "2026-10-09",
    ]);
  });

  it("reads dates run together with no separator at all", () => {
    // Habeen's row: two conflicts, one fragment, no comma between them.
    expect(days("11/13 large group 11/27 large group")).toEqual([
      "2026-11-13",
      "2026-11-27",
    ]);
  });

  it("reads month names, with or without a range", () => {
    expect(days("Nov 13")).toEqual(["2026-11-13"]);
    expect(days("October 2-4 (Club Retreat)")).toEqual(["2026-10-02→2026-10-04"]);
    expect(days("Sept. 18")).toEqual(["2026-09-18"]);
  });

  it("handles a multi-line answer", () => {
    const answer =
      "October 2-4 (Club Retreat)\nOctober 23 (Presentation)\n\nWill let you know if there are updates";
    const { blocks, unparsed } = parseConflicts(answer, FALL_2026);
    expect(blocks.map((b) => b.startYmd)).toEqual(["2026-10-02", "2026-10-23"]);
    // The trailing sentence names no date, so it's reported rather than dropped.
    expect(unparsed).toEqual(["Will let you know if there are updates"]);
  });

  it("treats the many spellings of 'nothing' as no conflicts", () => {
    for (const answer of ["", "n/a", "N/A", "none", "none at the moment", "No", "-"]) {
      expect(parseConflicts(answer, FALL_2026)).toEqual({ blocks: [], unparsed: [] });
    }
  });

  it("keeps the person's own wording as each block's note", () => {
    const { blocks } = parseConflicts("10/24 saturday rehearsal for Collegiate Sunday", FALL_2026);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].note).toBe("10/24 saturday rehearsal for Collegiate Sunday");
  });

  it("picks the year that lands the date inside the window", () => {
    // The window spans a new year: Jan belongs to 2027, Sep to 2026.
    const winter = { start: parseYmd("2026-09-01"), end: parseYmd("2027-03-31") };
    const at = (a: string) => parseConflicts(a, winter).blocks[0].startYmd;
    expect(at("9/25")).toBe("2026-09-25");
    expect(at("1/15")).toBe("2027-01-15");
  });

  it("honours an explicit year even outside the window", () => {
    expect(days("12/4/26 Large Group")).toEqual(["2026-12-04"]);
  });

  it("reports a date it cannot place instead of inventing one", () => {
    const { blocks, unparsed } = parseConflicts("5/5 offsite", FALL_2026);
    expect(blocks).toEqual([]);
    expect(unparsed).toEqual(["5/5 offsite"]);
  });

  it("rejects impossible dates rather than rolling them into the next month", () => {
    // new Date(2026, 8, 31) would silently become October 1st.
    expect(parseConflicts("9/31", FALL_2026).unparsed).toEqual(["9/31"]);
  });

  it("does not block the same day twice", () => {
    expect(days("9/25 Large Group, 9/25 rehearsal")).toEqual(["2026-09-25"]);
  });

  it("reports a fragment with no date so nothing is lost silently", () => {
    const { unparsed } = parseConflicts("sometime in November maybe", FALL_2026);
    expect(unparsed).toEqual(["sometime in November maybe"]);
  });
});

describe("parseDelimited", () => {
  it("reads tab-separated text (a Sheets copy/paste)", () => {
    expect(parseDelimited("a\tb\n1\t2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads comma-separated text (a CSV download)", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("keeps newlines and delimiters inside a quoted field", () => {
    const tsv = 'name\tanswer\nJoseph\t"October 2-4\nOctober 23"\n';
    expect(parseDelimited(tsv)).toEqual([
      ["name", "answer"],
      ["Joseph", "October 2-4\nOctober 23"],
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseDelimited('a\n"she said ""hi"""\n')).toEqual([["a"], ['she said "hi"']]);
  });

  it("strips a BOM and CRLF line endings", () => {
    expect(parseDelimited('﻿a,b\r\n1,2\r\n')).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("toRecords / findColumn", () => {
  const headers = [
    "Timestamp",
    "Email Address",
    "Please list out SPECIFIC scheduling conflicts in September–December 2026 (ex. 9/18 Large Group)",
    "Any other notes you would like us to keep in mind when scheduling?",
  ];

  it("keys cells by header and trims them", () => {
    expect(toRecords([["a", "b"], [" 1 ", "2"]])).toEqual([{ a: "1", b: "2" }]);
  });

  it("matches a long question by the words that survive a rewrite", () => {
    expect(findColumn(headers, "conflicts")).toBe(headers[2]);
    expect(findColumn(headers, "other notes")).toBe(headers[3]);
    expect(findColumn(headers, "email")).toBe("Email Address");
  });

  it("returns null when nothing matches", () => {
    expect(findColumn(headers, "phone number")).toBeNull();
  });
});

describe("ymd / parseYmd", () => {
  it("round-trips through LOCAL midnight, not UTC", () => {
    // toISOString() here would give the previous day west of UTC.
    expect(ymd(parseYmd("2026-09-25"))).toBe("2026-09-25");
    expect(parseYmd("2026-09-25").getHours()).toBe(0);
  });
});

// Someone on the form may already have an account — and may already have
// entered availability in the app. Importing their answer must not stack a
// second block on a day they've already blocked.
describe("daysBetween / isAlreadyCovered", () => {
  it("expands an inclusive day range", () => {
    expect(daysBetween("2026-10-02", "2026-10-04")).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(daysBetween("2026-10-02", "2026-10-02")).toEqual(["2026-10-02"]);
  });

  it("crosses a month boundary", () => {
    expect(daysBetween("2026-09-30", "2026-10-01")).toEqual([
      "2026-09-30",
      "2026-10-01",
    ]);
  });

  it("skips a conflict whose every day is already blocked", () => {
    const block = { startYmd: "2026-10-02", endYmd: "2026-10-04", note: "retreat" };
    const covered = new Set(["2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(isAlreadyCovered(block, covered)).toBe(true);
  });

  it("still imports a conflict that is only PARTLY covered", () => {
    // They blocked the Friday themselves; the rest of the retreat is new.
    const block = { startYmd: "2026-10-02", endYmd: "2026-10-04", note: "retreat" };
    expect(isAlreadyCovered(block, new Set(["2026-10-02"]))).toBe(false);
  });

  it("imports everything when nothing is covered", () => {
    const block = { startYmd: "2026-09-25", endYmd: "2026-09-25", note: "LG" };
    expect(isAlreadyCovered(block, new Set())).toBe(false);
  });
});
