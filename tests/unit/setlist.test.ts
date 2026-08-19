import { describe, expect, it } from "vitest";
import { describeSetlistChange, type SetlistSong } from "@/lib/setlist";

const song = (title: string, key: string | null = null): SetlistSong => ({ title, key });

describe("describeSetlistChange", () => {
  it("returns null when nothing changed", () => {
    const list = [song("God of Revival", "C"), song("Who Else", "E")];
    expect(describeSetlistChange(list, [...list])).toBeNull();
  });

  it("reports an added song with its key", () => {
    expect(
      describeSetlistChange([song("God of Revival", "C")], [
        song("God of Revival", "C"),
        song("Who Else", "E"),
      ])
    ).toBe('added "Who Else" (E)');
  });

  it("reports an added song with no key", () => {
    expect(describeSetlistChange([], [song("Who Else")])).toBe('added "Who Else"');
  });

  it("reports a removed song", () => {
    expect(
      describeSetlistChange([song("God of Revival", "C"), song("Who Else", "E")], [
        song("God of Revival", "C"),
      ])
    ).toBe('removed "Who Else" (E)');
  });

  it("reports a key change as from → to", () => {
    expect(
      describeSetlistChange([song("God of Revival", "C")], [song("God of Revival", "D")])
    ).toBe('changed "God of Revival" from C to D');
  });

  it("reports setting a previously unspecified key", () => {
    expect(
      describeSetlistChange([song("God of Revival")], [song("God of Revival", "D")])
    ).toBe('set the key of "God of Revival" to D');
  });

  it("reports clearing a key", () => {
    expect(
      describeSetlistChange([song("God of Revival", "C")], [song("God of Revival")])
    ).toBe('cleared the key of "God of Revival"');
  });

  it("combines several changes in one fragment", () => {
    expect(
      describeSetlistChange(
        [song("God of Revival", "C"), song("Old Song", "G")],
        [song("God of Revival", "D"), song("Who Else", "E")]
      )
    ).toBe('added "Who Else" (E); removed "Old Song" (G); changed "God of Revival" from C to D');
  });

  it("reports a pure reorder", () => {
    expect(
      describeSetlistChange(
        [song("God of Revival", "C"), song("Who Else", "E")],
        [song("Who Else", "E"), song("God of Revival", "C")]
      )
    ).toBe("reordered the setlist");
  });

  it("matches titles case- and whitespace-insensitively", () => {
    expect(
      describeSetlistChange([song("God of Revival", "C")], [song("  god of revival  ", "C")])
    ).toBeNull();
  });
});
