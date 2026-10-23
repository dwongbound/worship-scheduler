import { describe, expect, it } from "vitest";
import {
  AXIS_RATIO,
  FLICK_MS,
  SWIPE_SLOP,
  armDistance,
  gestureAxis,
  shouldCommit,
  swipeProgress,
  swipeTarget,
} from "@/lib/swipeNav";

describe("gestureAxis", () => {
  it("waits until the finger has left the slop", () => {
    expect(gestureAxis(0, 0)).toBe("undecided");
    expect(gestureAxis(SWIPE_SLOP - 1, SWIPE_SLOP - 1)).toBe("undecided");
  });

  it("claims a clearly sideways move", () => {
    expect(gestureAxis(60, 10)).toBe("horizontal");
    expect(gestureAxis(-60, 10)).toBe("horizontal");
  });

  // The whole point of the rewrite: a scroll that drifts sideways stays a
  // scroll. A 45° drag used to count as a swipe.
  it("leaves a drifting vertical scroll alone", () => {
    expect(gestureAxis(30, 30)).toBe("vertical"); // 45°
    expect(gestureAxis(40, 30)).toBe("vertical"); // still under the ratio
    expect(gestureAxis(5, 40)).toBe("vertical");
  });

  it("switches over exactly at the ratio", () => {
    expect(gestureAxis(30 * AXIS_RATIO, 30)).toBe("horizontal");
    expect(gestureAxis(30 * AXIS_RATIO - 1, 30)).toBe("vertical");
  });
});

describe("armDistance", () => {
  it("is a floored, capped fraction of the width", () => {
    expect(armDistance(390)).toBeCloseTo(390 * 0.33); // phone: in the band
    expect(armDistance(200)).toBe(90); // tiny: floored
    expect(armDistance(1023)).toBe(170); // tablet: capped
  });
});

describe("swipeProgress", () => {
  it("runs 0 → 1 over the pull, in either direction", () => {
    const w = 390;
    const full = armDistance(w);
    expect(swipeProgress(0, w)).toBe(0);
    expect(swipeProgress(full / 2, w)).toBeCloseTo(0.5);
    expect(swipeProgress(-full / 2, w)).toBeCloseTo(0.5);
  });

  it("clamps at a full pull, however far you keep going", () => {
    expect(swipeProgress(9999, 390)).toBe(1);
  });
});

describe("shouldCommit", () => {
  it("goes on a full pull", () => {
    expect(shouldCommit(1, 5_000)).toBe(true);
  });

  it("stays put on a short slow drag", () => {
    expect(shouldCommit(0.9, 2_000)).toBe(false);
    expect(shouldCommit(0.2, 50)).toBe(false); // quick, but barely moved
  });

  it("accepts a quick flick that got halfway", () => {
    expect(shouldCommit(0.6, FLICK_MS - 1)).toBe(true);
    expect(shouldCommit(0.6, FLICK_MS + 1)).toBe(false);
  });
});

describe("swipeTarget", () => {
  it("picks the tab the finger is heading toward", () => {
    expect(swipeTarget(1, -50, 4)).toBe(2); // finger left → right-hand tab
    expect(swipeTarget(1, 50, 4)).toBe(0);
  });

  it("reports nothing at either end", () => {
    expect(swipeTarget(0, 50, 4)).toBeNull();
    expect(swipeTarget(3, -50, 4)).toBeNull();
  });
});
