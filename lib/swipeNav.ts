// The numbers behind the tab-swipe gesture (components/SwipePager.tsx), kept
// pure so they can be unit-tested without a touchscreen.
//
// The gesture's whole job is to be IGNORABLE. A finger dragging down a long
// page never travels in a straight line, and the old pager translated the page
// sideways on any move that was even slightly more horizontal than vertical —
// so a plain scroll left the content parked off-centre. Two rules fix that:
// the axis test below demands a clearly horizontal move before the gesture
// engages at all, and the page itself never moves — only an edge cue does, so
// the worst a misread can do is flash an arrow.

/** Movement (px, either axis) before the gesture commits to an axis. */
export const SWIPE_SLOP = 12;

/**
 * How much more horizontal than vertical a move must be to count as a swipe.
 * 1.5 ≈ within 34° of horizontal: comfortably reachable when you mean it,
 * well clear of the drift in a one-handed vertical scroll.
 */
export const AXIS_RATIO = 1.5;

/** A drag shorter than this (ms) counts as a flick… */
export const FLICK_MS = 250;
/** …and a flick commits at this much of the pull instead of all of it. */
export const FLICK_PROGRESS = 0.5;

// The pull length is a fraction of the viewport, floored and capped so the
// gesture feels the same on a small phone and a 12" tablet.
const PULL_RATIO = 0.33;
const PULL_MIN = 90;
const PULL_MAX = 170;

/** How far (px) the finger must travel for a full pull at this width. */
export function armDistance(width: number): number {
  return Math.min(PULL_MAX, Math.max(PULL_MIN, width * PULL_RATIO));
}

/**
 * Which axis this move belongs to. "undecided" = still inside the slop, ask
 * again on the next move; "vertical" = hands the touch back to the page and
 * must stick for the rest of the gesture (otherwise a scroll that wanders
 * sideways halfway down would still trigger a swipe).
 */
export function gestureAxis(dx: number, dy: number): "undecided" | "horizontal" | "vertical" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < SWIPE_SLOP && ay < SWIPE_SLOP) return "undecided";
  return ax >= ay * AXIS_RATIO ? "horizontal" : "vertical";
}

/** 0 → 1: how full the pull is, which is exactly the cue's opacity. */
export function swipeProgress(dx: number, width: number): number {
  return Math.min(1, Math.abs(dx) / armDistance(width));
}

/**
 * Release behaviour: a full pull goes, and so does a quick flick that got at
 * least halfway — a deliberate flick shouldn't have to be a long one.
 */
export function shouldCommit(progress: number, elapsedMs: number): boolean {
  if (progress >= 1) return true;
  return elapsedMs < FLICK_MS && progress >= FLICK_PROGRESS;
}

/** Finger left → the tab to the right of this one, and vice versa. */
export function swipeTarget(activeIndex: number, dx: number, tabCount: number): number | null {
  const next = activeIndex + (dx < 0 ? 1 : -1);
  return next >= 0 && next < tabCount ? next : null;
}
