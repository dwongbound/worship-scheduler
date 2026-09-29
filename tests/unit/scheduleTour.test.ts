// Unit tests for the review workspace's guided tour (lib/scheduleTour.ts) and
// the per-browser "already seen" flags behind both tours (lib/tourSeen.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tourSteps } from "@/lib/scheduleTour";
import {
  APP_TOUR_KEY,
  hasSeenTour,
  markTourSeen,
  scheduleTourKey,
} from "@/lib/tourSeen";

describe("tourSteps", () => {
  const generate = tourSteps({ preview: false });
  const preview = tourSteps({ preview: true });

  it("gives every step an id, a title and something to say", () => {
    for (const steps of [generate, preview]) {
      expect(steps.length).toBeGreaterThan(0);
      for (const step of steps) {
        expect(step.id).toBeTruthy();
        expect(step.title).toBeTruthy();
        expect(step.body.length).toBeGreaterThan(0);
        expect(step.body.every((p) => p.trim().length > 0)).toBe(true);
      }
    }
  });

  it("has unique step ids, so the dots and any test can key off them", () => {
    for (const steps of [generate, preview]) {
      expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    }
  });

  it("covers every quirk the screen has, in both modes", () => {
    // The tour is now the ONLY explanation of this workspace, so a step going
    // missing is a feature becoming undiscoverable.
    const expected = [
      "overview",
      "views",
      "load",
      "hover",
      "lock",
      "card",
      "clipboard",
      "warnings",
      "commit",
    ];
    expect(generate.map((s) => s.id)).toEqual(expected);
    expect(preview.map((s) => s.id)).toEqual(expected);
  });

  it("talks about drafts only where drafts exist", () => {
    // Preview Mode edits real sets — there is nothing to park, so offering to
    // save a draft there would describe a button that isn't on the screen.
    const text = (steps: ReturnType<typeof tourSteps>) =>
      steps.flatMap((s) => s.body).join(" ");
    expect(text(generate)).toMatch(/Save Draft/);
    expect(text(preview)).not.toMatch(/Save Draft/);
  });

  it("names the commit button each mode actually shows", () => {
    const last = (steps: ReturnType<typeof tourSteps>) =>
      steps[steps.length - 1].body.join(" ");
    expect(last(generate)).toMatch(/Apply schedule/);
    expect(last(preview)).toMatch(/Save Changes/);
    expect(last(preview)).not.toMatch(/Apply schedule/);
  });
});

describe("tour seen flags", () => {
  // A tiny in-memory localStorage; vitest runs in node, where there is none.
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is false until marked, and true after", () => {
    expect(hasSeenTour(APP_TOUR_KEY)).toBe(false);
    markTourSeen(APP_TOUR_KEY);
    expect(hasSeenTour(APP_TOUR_KEY)).toBe(true);
  });

  it("keys the two review tours separately", () => {
    // The Create tab's proposal and the calendar's Preview Mode are different
    // screens; being shown one must not silence the other.
    expect(scheduleTourKey("generate")).not.toBe(scheduleTourKey("preview"));
    markTourSeen(scheduleTourKey("generate"));
    expect(hasSeenTour(scheduleTourKey("generate"))).toBe(true);
    expect(hasSeenTour(scheduleTourKey("preview"))).toBe(false);
  });

  it("keeps the app tour separate from the review ones", () => {
    markTourSeen(scheduleTourKey("generate"));
    expect(hasSeenTour(APP_TOUR_KEY)).toBe(false);
  });

  it("reports 'seen' when storage throws, rather than nagging every visit", () => {
    // Private-browsing modes throw on access. A browser that can never record
    // the flag would otherwise reopen the tour on every single page load.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(hasSeenTour(APP_TOUR_KEY)).toBe(true);
    // And marking it must not throw out into the caller's render.
    expect(() => markTourSeen(APP_TOUR_KEY)).not.toThrow();
  });
});
