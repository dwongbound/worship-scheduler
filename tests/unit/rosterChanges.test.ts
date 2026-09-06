import { describe, expect, it } from "vitest";
import { describeRosterChanges, type RosterChange } from "@/lib/rosterChanges";

// Roles read in the team's own words; this stands in for roleLabel.
const label = (role: string) =>
  ({ DRUMS: "Drums", BASS: "Bass", KEYS: "Keys" })[role] ?? role;

const added = (name: string, role: string): RosterChange => ({
  kind: "added",
  role,
  name,
});

describe("describeRosterChanges", () => {
  it("says nothing when nothing changed", () => {
    expect(describeRosterChanges([], label)).toBeNull();
  });

  // One change is its own sentence — a header over a single line is noise.
  it("renders a lone addition as a plain sentence, with no header", () => {
    const text = describeRosterChanges([added("Kate Kim", "DRUMS")], label);
    expect(text).toBe("\u{2795} Kate Kim was added on Drums.");
    expect(text).not.toContain("Roster update");
  });

  it("renders a lone removal and a lone reassignment the same way", () => {
    expect(
      describeRosterChanges(
        [{ kind: "removed", role: "BASS", name: "Dave Diaz" }],
        label
      )
    ).toBe("\u{2796} Dave Diaz is no longer on Bass.");
    expect(
      describeRosterChanges(
        [
          {
            kind: "reassigned",
            role: "KEYS",
            name: "Ivy Ito",
          },
        ],
        label
      )
    ).toBe("\u{1F501} Ivy Ito is now playing Keys.");
  });

  // The whole point of the batch: one message per save, not one per seat.
  it("gathers several changes under one header carrying the count", () => {
    const text = describeRosterChanges(
      [
        added("Kate Kim", "DRUMS"),
        { kind: "removed", role: "BASS", name: "Dave Diaz" },
        {
          kind: "reassigned",
          role: "KEYS",
          name: "Ivy Ito",
        },
      ],
      label
    );
    const lines = (text ?? "").split("\n");
    expect(lines[0]).toContain("3 changes");
    expect(lines).toHaveLength(4); // header + one per change
    expect(lines[1]).toBe("\u{2795} Kate Kim was added on Drums.");
    expect(lines[2]).toBe("\u{2796} Dave Diaz is no longer on Bass.");
    expect(lines[3]).toBe("\u{1F501} Ivy Ito is now playing Keys.");
  });

  it("uses the team's own label for a role, not the raw key", () => {
    const text = describeRosterChanges(
      [added("Kate Kim", "DRUMS"), added("Nina Nguyen", "KEYS")],
      (role) => (role === "DRUMS" ? "Percussion" : label(role))
    );
    expect(text).toContain("Percussion");
    expect(text).not.toContain("DRUMS");
  });
});
