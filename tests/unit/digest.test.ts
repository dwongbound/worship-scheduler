// Unit tests for the daily digest's message formatting (lib/digest.ts).
// buildOrgDigest talks to the db, so it's covered by the e2e/manual paths —
// what's pinned here is the pure rendering every DM goes through.
import { describe, expect, it } from "vitest";
import { renderDigestText, type DigestItem } from "@/lib/digest";
import {
  DIGEST_WINDOW_END_MINUTE,
  DIGEST_WINDOW_START_MINUTE,
  windowPhrase,
} from "@/lib/constants";

const BASE = "https://tapworship.com";

const items: DigestItem[] = [
  { text: "Fill out the availability request “Fall 2026” for Grace", path: "/schedule" },
  { text: "You have 1 set today, at 2:00 PM Sunday Morning", path: "/calendar" },
  { text: "3 swap requests waiting on your approval", path: "/approvals" },
];

describe("renderDigestText", () => {
  it("greets by first name only", () => {
    const text = renderDigestText("Carol Danvers", items, BASE);
    expect(text.split("\n")[0]).toContain("Carol");
    expect(text).not.toContain("Danvers");
  });

  it("falls back to the whole name when there's no space to split on", () => {
    expect(renderDigestText("carol", items, BASE)).toContain("carol");
  });

  it("renders one linked bullet per item, in order", () => {
    const lines = renderDigestText("Carol", items, BASE).split("\n").slice(1);
    expect(lines).toEqual([
      `• <${BASE}/schedule|Fill out the availability request “Fall 2026” for Grace>`,
      `• <${BASE}/calendar|You have 1 set today, at 2:00 PM Sunday Morning>`,
      `• <${BASE}/approvals|3 swap requests waiting on your approval>`,
    ]);
  });

  it("degrades to plain bullets when the app url is unknown", () => {
    const text = renderDigestText("Carol", items, "");
    expect(text).toContain("• Fill out the availability request");
    // No half-built links: an empty base must not emit "<|...>".
    expect(text).not.toContain("<");
  });

  it("is just the greeting when there's nothing to report", () => {
    // The sender skips empty digests, so this only guards the shape.
    expect(renderDigestText("Carol", [], BASE).split("\n")).toHaveLength(1);
  });
});

// The send gate in sendDailyDigests compares the server's LOCAL clock against
// the window, but Vercel schedules the cron in UTC — so the local hour moves an
// hour across DST. A hard 8 AM check used to skip every winter run. This pins
// both DST offsets against the window so changing either side trips a test.
describe("the cron slot lands inside the digest window", () => {
  const CRON_UTC_HOUR = 16; // vercel.json: "0 16 * * *"
  const APP_TZ = "America/Los_Angeles";

  // Local minutes-from-midnight in APP_TZ for the cron firing on `isoDate`,
  // read via Intl so the result doesn't depend on the test runner's own TZ.
  function localMinutes(isoDate: string): number {
    const at = new Date(`${isoDate}T${String(CRON_UTC_HOUR).padStart(2, "0")}:00:00Z`);
    const [h, m] = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(at)
      .split(":")
      .map(Number);
    return h * 60 + m;
  }

  it.each([
    ["PST (winter)", "2026-01-15", 8 * 60],
    ["PDT (summer)", "2026-07-15", 9 * 60],
  ])("%s fires at %s local, inside the window", (_label, isoDate, expected) => {
    const minutes = localMinutes(isoDate as string);
    expect(minutes).toBe(expected);
    expect(minutes).toBeGreaterThanOrEqual(DIGEST_WINDOW_START_MINUTE);
    expect(minutes).toBeLessThan(DIGEST_WINDOW_END_MINUTE);
  });
});

// The digest quotes its own look-ahead window so the reader knows what a count
// covers ("2 sets in the next two weeks…"). The org picks the number, so the
// phrasing has to stay natural across the whole allowed range.
describe("windowPhrase", () => {
  it("uses natural phrasing for the common horizons", () => {
    expect(windowPhrase(1)).toBe("today");
    expect(windowPhrase(7)).toBe("in the next week");
    expect(windowPhrase(14)).toBe("in the next two weeks");
    expect(windowPhrase(30)).toBe("in the next month");
  });

  it("falls back to a plain day count for anything else", () => {
    expect(windowPhrase(3)).toBe("in the next 3 days");
    expect(windowPhrase(45)).toBe("in the next 45 days");
  });

  it("reads as a sentence in the lines that use it", () => {
    // How buildOrgDigest assembles them — guards against a phrase that only
    // works standalone (e.g. one starting with a capital).
    expect(`Confirm your spot on 2 sets ${windowPhrase(14)}`).toBe(
      "Confirm your spot on 2 sets in the next two weeks"
    );
    expect(`3 sets ${windowPhrase(7)} have people who haven’t confirmed`).toBe(
      "3 sets in the next week have people who haven’t confirmed"
    );
  });
});
