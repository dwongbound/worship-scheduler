// Unit tests for the daily digest's message formatting (lib/digest.ts).
// buildOrgDigest talks to the db, so it's covered by the e2e/manual paths —
// what's pinned here is the pure rendering every DM goes through.
import { describe, expect, it } from "vitest";
import { renderDigestText, type DigestItem } from "@/lib/digest";

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
