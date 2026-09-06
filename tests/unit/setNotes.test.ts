import { describe, expect, it } from "vitest";
import {
  NOTE_EXCERPT_LIMIT,
  describeNotesChange,
  noteTextFromDetail,
} from "@/lib/setNotes";

describe("describeNotesChange", () => {
  it("returns null when nothing changed", () => {
    expect(describeNotesChange("Doors at 8", "Doors at 8")).toBeNull();
  });

  it("treats null, undefined and empty as the same empty note", () => {
    expect(describeNotesChange(null, "")).toBeNull();
    expect(describeNotesChange(undefined, null)).toBeNull();
    expect(describeNotesChange("", undefined)).toBeNull();
  });

  it("ignores whitespace-only differences", () => {
    // The notes box saves with every other staged edit, so a retyped line
    // break must not read as a change.
    expect(describeNotesChange("Doors at 8", "  Doors   at 8 ")).toBeNull();
    expect(describeNotesChange("Doors at 8", "Doors\nat 8")).toBeNull();
  });

  it("reports a first note with its text", () => {
    expect(describeNotesChange(null, "Bring extra cables")).toBe(
      'added a note: "Bring extra cables"'
    );
  });

  it("reports a rewrite with the NEW text", () => {
    expect(describeNotesChange("Doors at 8", "Doors at 7:30")).toBe(
      'updated the notes: "Doors at 7:30"'
    );
  });

  it("reports a clear without quoting anything", () => {
    expect(describeNotesChange("Doors at 8", "   ")).toBe("cleared the notes");
  });

  it("truncates a long note so one entry can't swallow the list", () => {
    const long = "x".repeat(NOTE_EXCERPT_LIMIT + 50);
    const described = describeNotesChange(null, long);
    expect(described).toBe(`added a note: "${"x".repeat(NOTE_EXCERPT_LIMIT)}…"`);
  });

  it("keeps a note that exactly fits the limit whole", () => {
    const exact = "y".repeat(NOTE_EXCERPT_LIMIT);
    expect(describeNotesChange(null, exact)).toBe(`added a note: "${exact}"`);
  });
});

describe("noteTextFromDetail", () => {
  it("gives back the note itself, without the log wrapper or quotes", () => {
    expect(noteTextFromDetail('added a note: "Bring extra cables"')).toBe(
      "Bring extra cables"
    );
    expect(noteTextFromDetail('updated the notes: "Doors at 7:30"')).toBe(
      "Doors at 7:30"
    );
  });

  it("keeps a note that quotes something itself", () => {
    expect(
      noteTextFromDetail('added a note: "Play \"Who Else\" last"')
    ).toBe('Play \"Who Else\" last');
  });

  it("passes through a fragment with no excerpt, and empty input", () => {
    expect(noteTextFromDetail("cleared the notes")).toBe("cleared the notes");
    expect(noteTextFromDetail(null)).toBe("");
  });
});
