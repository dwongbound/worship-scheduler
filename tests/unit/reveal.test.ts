// Unit tests for lib/reveal — the public home page's scroll motion.
//
// The load-bearing property here isn't the animation, it's that the page
// READS WITHOUT IT: Google's OAuth verification fetches this URL with no
// account and no JavaScript, and the page exists so that review can see the
// app's name and mark. Several of these tests are there to catch the day
// someone makes the hidden state the default.
import { describe, expect, it } from "vitest";
import {
  REVEAL_ATTR,
  REVEAL_CHILD_COUNT,
  REVEAL_CLASS,
  REVEAL_CSS,
  REVEAL_IN_CLASS,
  REVEAL_MAX_DELAY_MS,
  REVEAL_SCRIPT,
  REVEAL_STAGGER_CLASS,
  REVEAL_STAGGER_MS,
  revealDelay,
  revealEnabled,
} from "@/lib/reveal";

describe("revealEnabled", () => {
  it("animates by default and not for someone who asked for less motion", () => {
    expect(revealEnabled(false)).toBe(true);
    expect(revealEnabled(true)).toBe(false);
  });
});

describe("revealDelay", () => {
  it("steps each item of a group later than the one before", () => {
    expect(revealDelay(0)).toBe(0);
    expect(revealDelay(1)).toBe(REVEAL_STAGGER_MS);
    expect(revealDelay(3)).toBe(3 * REVEAL_STAGGER_MS);
  });

  it("caps a long group, so the last row isn't still arriving a second later", () => {
    expect(revealDelay(100)).toBe(REVEAL_MAX_DELAY_MS);
    expect(revealDelay(100, 10, 250)).toBe(250);
  });

  it("treats a negative index as first", () => {
    expect(revealDelay(-2)).toBe(0);
  });
});

describe("the no-JavaScript contract", () => {
  // The sheet as selector→body pairs, so a declaration on its own line is
  // read together with the selector that owns it.
  const blocks = REVEAL_CSS.split("}")
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.includes("{"))
    .map((chunk) => {
      const i = chunk.indexOf("{");
      return { selector: chunk.slice(0, i).trim(), body: chunk.slice(i + 1).trim() };
    });

  // Every hiding rule is scoped under the attribute, and only the script sets
  // it. A rule that hides a `.reveal` unconditionally would blank the page for
  // the OAuth review, which is the failure this page was built to fix.
  it("hides nothing unless the pre-paint script has armed it", () => {
    const hiding = blocks.filter(
      (b) => /opacity:\s*0\b/.test(b.body) || /translateY/.test(b.body)
    );
    expect(hiding.length).toBeGreaterThan(0);
    for (const b of hiding) {
      expect(b.selector).toContain(`html[${REVEAL_ATTR}="on"]`);
    }
  });

  it("scopes every rule it ships to the attribute or to motion-safe", () => {
    for (const b of blocks) {
      const scoped = b.selector.includes(`html[${REVEAL_ATTR}="on"]`);
      const motionQuery = b.selector.includes("prefers-reduced-motion");
      // The smooth-scroll rule's own `html{...}` sits inside that query.
      const insideQuery = b.selector === "html";
      expect(scoped || motionQuery || insideQuery).toBe(true);
    }
  });

  it("arms nothing when the visitor asked for reduced motion", () => {
    expect(REVEAL_SCRIPT).toContain("prefers-reduced-motion: reduce");
    // `!matches` — the attribute goes on when the query does NOT match.
    expect(REVEAL_SCRIPT).toContain("!matchMedia");
    expect(REVEAL_SCRIPT).toContain(`setAttribute('${REVEAL_ATTR}','on')`);
  });

  it("can't throw on a browser without matchMedia", () => {
    expect(REVEAL_SCRIPT.startsWith("try{")).toBe(true);
    expect(REVEAL_SCRIPT).toContain("catch(e){}");
  });

  it("has a revealed state for both the item and a staggered child", () => {
    expect(REVEAL_CSS).toContain(`.${REVEAL_CLASS}.${REVEAL_IN_CLASS}{opacity:1`);
    expect(REVEAL_CSS).toContain(
      `.${REVEAL_CLASS}.${REVEAL_IN_CLASS} .${REVEAL_STAGGER_CLASS} > *`
    );
  });

  it("gives every child the stagger covers its own delay", () => {
    for (let i = 1; i <= REVEAL_CHILD_COUNT; i++) {
      expect(REVEAL_CSS).toContain(`:nth-child(${i})`);
    }
  });
});
