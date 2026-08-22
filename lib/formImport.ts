// Parsing for the availability Google Form export — the pure half of the
// roster import (prisma/importFormResponses.ts does the db writes).
//
// Two jobs:
//   1. Read the export. Sheets gives CSV on download and TSV on copy/paste,
//      and one answer in the real export contains both newlines and quotes, so
//      this needs a proper RFC-4180 reader rather than a `split(",")`.
//   2. Turn a free-text conflicts answer ("9/11 Large Group, 10/9 Large Group")
//      into whole-day blocks. People wrote these by hand, so the parser scans
//      for dates instead of trusting any separator, and anything it can't
//      resolve is REPORTED rather than guessed at — a silently dropped conflict
//      is someone getting scheduled on a day they said they were away.

/** A whole-day block parsed out of one conflicts answer. */
export interface ConflictBlock {
  /** First day blocked, "YYYY-MM-DD". */
  startYmd: string;
  /** Last day blocked; equal to startYmd for a single-day conflict. */
  endYmd: string;
  /** The fragment of the answer it came from, kept as the block's note. */
  note: string;
}

export interface ParsedConflicts {
  blocks: ConflictBlock[];
  /**
   * Fragments that named no date we could place in the window. Never silently
   * dropped — the import prints these for a human to enter by hand.
   */
  unparsed: string[];
}

/** The date window a bare "9/25" is resolved into (an AvailabilityRequest's). */
export interface DateWindow {
  start: Date;
  end: Date;
}

// ---------------------------------------------------------------------------
// Delimited-text reading
// ---------------------------------------------------------------------------

/**
 * Parse RFC-4180 delimited text into rows of cells. Handles quoted fields
 * containing the delimiter, newlines, and doubled quotes (`""` → `"`).
 * The delimiter defaults to whatever the first line uses — a tab if there is
 * one before any comma (a Sheets copy/paste), otherwise a comma (a CSV export).
 */
export function parseDelimited(text: string, delimiter?: string): string[][] {
  const delim = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  // Strip a UTF-8 BOM and normalise line endings so \r never lands in a cell.
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (quoted) {
      if (ch !== '"') {
        cell += ch;
      } else if (src[i + 1] === '"') {
        cell += '"'; // an escaped quote inside a quoted field
        i++;
      } else {
        quoted = false;
      }
      continue;
    }

    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  // Whatever is left after the last newline is a final row, unless the file
  // simply ended with one.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop blank trailing lines.
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const tab = firstLine.indexOf("\t");
  const comma = firstLine.indexOf(",");
  if (tab === -1) return ",";
  if (comma === -1) return "\t";
  return tab < comma ? "\t" : ",";
}

/**
 * Turn parsed rows into objects keyed by header. Headers are matched loosely
 * elsewhere (see findColumn) because the form's question text is long and
 * changes wording between semesters.
 */
export function toRecords(rows: string[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = (cells[i] ?? "").trim();
    });
    return record;
  });
}

/**
 * Find the header whose text contains every one of `needles` (case-insensitive)
 * — so "conflicts" matches the form's full "Please list out SPECIFIC scheduling
 * conflicts in September–December 2026 (ex. ...)" question without hard-coding
 * a sentence that will be reworded next semester.
 */
export function findColumn(
  headers: string[],
  ...needles: string[]
): string | null {
  const lowered = needles.map((n) => n.toLowerCase());
  return (
    headers.find((h) => {
      const hl = h.toLowerCase();
      return lowered.every((n) => hl.includes(n));
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// Conflict parsing
// ---------------------------------------------------------------------------

// Answers that mean "no conflicts". Matched against the whole trimmed answer,
// so "none at the moment" counts but "none in September except 10/3" does not.
const NO_CONFLICT_RE =
  /^(n\/?a|none( at the moment| so far| yet)?|no|nope|nothing( yet)?|-+|\.)$/i;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

// "9/25", "10/16/26", "12/4/2026"
const NUMERIC_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
// "Nov 13", "October 2-4", "Sept. 18" — with an optional day range.
const NAMED_DATE_RE = new RegExp(
  `\\b(${Object.keys(MONTHS).join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:\\s*[-–—]\\s*(\\d{1,2}))?\\b`,
  "gi"
);

/**
 * Parse one conflicts answer into whole-day blocks.
 *
 * A bare "9/25" carries no year, so each match is resolved to the year that
 * puts it inside `window` (the availability request's range). A date that fits
 * no year in the window is reported as unparsed rather than guessed.
 */
export function parseConflicts(
  answer: string,
  window: DateWindow
): ParsedConflicts {
  const text = (answer ?? "").trim();
  if (text === "" || NO_CONFLICT_RE.test(text)) {
    return { blocks: [], unparsed: [] };
  }

  const blocks: ConflictBlock[] = [];
  const unparsed: string[] = [];
  const seen = new Set<string>();

  // People separate conflicts with commas, semicolons, or just newlines — and
  // sometimes not at all ("11/13 large group 11/27 large group"), which is why
  // each fragment is still scanned for EVERY date it contains.
  for (const fragment of text.split(/[,;\n]+/)) {
    const note = fragment.trim();
    if (note === "" || NO_CONFLICT_RE.test(note)) continue;

    const found = matchesIn(note, window);
    if (found.length === 0) {
      unparsed.push(note);
      continue;
    }
    for (const { startYmd, endYmd } of found) {
      // One person listing the same day twice shouldn't make two blocks.
      const key = `${startYmd}..${endYmd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ startYmd, endYmd, note });
    }
  }

  blocks.sort((a, b) => a.startYmd.localeCompare(b.startYmd));
  return { blocks, unparsed };
}

/** Every date (or day range) inside one fragment, resolved against the window. */
function matchesIn(
  fragment: string,
  window: DateWindow
): { startYmd: string; endYmd: string }[] {
  const out: { startYmd: string; endYmd: string }[] = [];

  for (const m of fragment.matchAll(NUMERIC_DATE_RE)) {
    const [, month, day, year] = m;
    const ymd = resolveYmd(+month, +day, year ? fullYear(+year) : null, window);
    if (ymd) out.push({ startYmd: ymd, endYmd: ymd });
  }

  for (const m of fragment.matchAll(NAMED_DATE_RE)) {
    const month = MONTHS[m[1].toLowerCase()];
    const start = resolveYmd(month, +m[2], null, window);
    if (!start) continue;
    // "October 2-4" is one block spanning three days.
    const end = m[3] ? resolveYmd(month, +m[3], null, window) : null;
    out.push({ startYmd: start, endYmd: end ?? start });
  }

  return out;
}

/** Two-digit years are this century ("26" → 2026). */
function fullYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/**
 * "9/25" → "2026-09-25", by picking the year that lands inside the window.
 * Returns null when the date is invalid or fits no year in range — the caller
 * reports those instead of inventing a date.
 */
function resolveYmd(
  month: number,
  day: number,
  year: number | null,
  window: DateWindow
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const candidates =
    year !== null
      ? [year]
      : yearsIn(window);

  for (const y of candidates) {
    const date = new Date(y, month - 1, day);
    // Rejects overflow like 9/31, which JS would roll into October.
    if (date.getMonth() !== month - 1 || date.getDate() !== day) continue;
    if (year === null && (date < startOfDay(window.start) || date > window.end)) {
      continue;
    }
    return ymd(date);
  }
  return null;
}

function yearsIn(window: DateWindow): number[] {
  const years: number[] = [];
  for (let y = window.start.getFullYear(); y <= window.end.getFullYear(); y++) {
    years.push(y);
  }
  return years;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Local-date → "YYYY-MM-DD" (never via toISOString, which shifts to UTC). */
export function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DD" → local midnight, matching how the availability API stores days. */
export function parseYmd(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// ---------------------------------------------------------------------------
// Merging against availability that already exists
// ---------------------------------------------------------------------------

/**
 * Every "YYYY-MM-DD" an inclusive [start, end] day range covers. Used to work
 * out what a person is ALREADY marked unavailable for, so importing their form
 * answer doesn't stack a second block on a day they've already blocked in the
 * app themselves.
 */
export function daysBetween(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const end = parseYmd(endYmd);
  for (let d = parseYmd(startYmd); d <= end; d.setDate(d.getDate() + 1)) {
    out.push(ymd(d));
  }
  return out;
}

/**
 * Is this conflict already fully accounted for? True only when EVERY day it
 * covers is in `covered` — a partial overlap still gets imported, because the
 * days it adds are real. Keeps a re-run (and an import over someone who already
 * answered in the app) from duplicating rows.
 */
export function isAlreadyCovered(
  block: ConflictBlock,
  covered: Set<string>
): boolean {
  return daysBetween(block.startYmd, block.endYmd).every((d) => covered.has(d));
}
