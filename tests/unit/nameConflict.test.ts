import { describe, expect, it } from "vitest";
import {
  type NameConflict,
  nameConflictRedirect,
  normalizeName,
  parseNameConflicts,
} from "@/lib/nameConflict";

const conflict = (
  email: string,
  name: string,
  isPlaceholder = false
): NameConflict => ({ email, name, isPlaceholder });

describe("normalizeName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeName("  Jane   Kim ")).toBe("Jane Kim");
  });

  it("leaves an already-clean name alone", () => {
    expect(normalizeName("Jane Kim")).toBe("Jane Kim");
  });

  it("returns empty for whitespace only", () => {
    expect(normalizeName("   ")).toBe("");
  });
});

describe("nameConflictRedirect / parseNameConflicts", () => {
  it("round-trips a single conflict", () => {
    const conflicts = [conflict("jane@kim.com", "Jane Kim")];
    const url = nameConflictRedirect("jane.kim@work.com", conflicts);
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.get("nameConflict")).toBe("jane.kim@work.com");
    expect(parseNameConflicts(params.get("conflicts"))).toEqual(conflicts);
  });

  it("round-trips several, keeping the placeholder flag per row", () => {
    const conflicts = [
      conflict("jane@kim.com", "Jane Kim"),
      conflict("jkim@roster.com", "jane kim", true),
    ];
    const params = new URLSearchParams(
      nameConflictRedirect("jane.kim@work.com", conflicts).split("?")[1]
    );
    expect(parseNameConflicts(params.get("conflicts"))).toEqual(conflicts);
  });

  it("survives a name containing the field separator", () => {
    const conflicts = [conflict("odd@name.com", "Jane | Kim")];
    const params = new URLSearchParams(
      nameConflictRedirect("jane@work.com", conflicts).split("?")[1]
    );
    expect(parseNameConflicts(params.get("conflicts"))).toEqual(conflicts);
  });

  it("returns nothing for a missing or unparseable param", () => {
    expect(parseNameConflicts(null)).toEqual([]);
    expect(parseNameConflicts("")).toEqual([]);
    expect(parseNameConflicts("garbage")).toEqual([]);
  });
});
