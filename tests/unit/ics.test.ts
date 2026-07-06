// Unit tests for the .ics calendar export (lib/ics.ts).
import { describe, expect, it } from "vitest";
import { buildIcs, escapeIcsText, formatIcsDate, setEventTitle } from "@/lib/ics";

describe("setEventTitle", () => {
  it("appends one (Role) per role in ROLE_ORDER", () => {
    // Passed out of order → normalized to ROLE_ORDER (leader before acoustic).
    expect(
      setEventTitle("Thursday Night Set", ["ACOUSTIC_GUITAR", "WORSHIP_LEADER"])
    ).toBe("Thursday Night Set (Worship Leader) (Acoustic Guitar)");
  });

  it("de-duplicates repeated roles", () => {
    expect(setEventTitle("Sunday Morning", ["DRUMS", "DRUMS"])).toBe(
      "Sunday Morning (Drums)"
    );
  });

  it("is just the set name when there are no roles", () => {
    expect(setEventTitle("Prayer Night", [])).toBe("Prayer Night");
  });

  it("falls back to 'Worship Set' for a missing label", () => {
    expect(setEventTitle(null, ["BASS"])).toBe("Worship Set (Bass)");
  });
});

describe("formatIcsDate", () => {
  it("formats as UTC basic format with Z suffix", () => {
    const d = new Date(Date.UTC(2026, 0, 5, 19, 30, 0));
    expect(formatIcsDate(d)).toBe("20260105T193000Z");
  });
});

describe("escapeIcsText", () => {
  it("escapes commas, semicolons, backslashes and newlines", () => {
    expect(escapeIcsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
  });
});

describe("buildIcs", () => {
  const event = {
    id: "abc123",
    title: "Sunday Morning (Drums)",
    description: "Role: Drums",
    start: new Date(Date.UTC(2026, 0, 5, 17, 0)),
    durationMinutes: 90,
  };

  it("produces a valid VCALENDAR wrapper", () => {
    const ics = buildIcs([event]);
    expect(ics.startsWith("BEGIN:VCALENDAR")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
  });

  it("uses CRLF line endings (RFC 5545)", () => {
    const ics = buildIcs([event]);
    expect(ics).toContain("\r\n");
    // No bare LFs: splitting on CRLF should reproduce the doc.
    expect(ics.split("\r\n").join("\r\n")).toBe(ics);
  });

  it("computes DTEND from the duration", () => {
    const ics = buildIcs([event]);
    expect(ics).toContain("DTSTART:20260105T170000Z");
    expect(ics).toContain("DTEND:20260105T183000Z"); // +90 min
  });

  it("emits one VEVENT per event with stable UIDs", () => {
    const ics = buildIcs([event, { ...event, id: "def456" }]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain("UID:abc123@worship-scheduler");
    expect(ics).toContain("UID:def456@worship-scheduler");
  });

  it("escapes special characters in the summary", () => {
    const ics = buildIcs([{ ...event, title: "Rock, Paper; Scissors" }]);
    expect(ics).toContain("SUMMARY:Rock\\, Paper\\; Scissors");
  });
});
