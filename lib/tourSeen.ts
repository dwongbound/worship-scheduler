// "Has this browser been shown that walkthrough yet?" — the one place the app
// remembers a tour it has already run once.
//
// localStorage, not the database: a tour is a per-browser courtesy, not
// something worth a write on every person's row, and the cost of getting it
// wrong is one extra dialog. Every access is wrapped, because a browser in
// private mode (or with site data blocked) THROWS on access rather than
// returning null — and an onboarding nicety must never be what breaks a page.
//
// Two tours use this: the app-wide GuidedTour, and the review workspace's own
// (once for the generate flow, once for the calendar's Preview Mode — they are
// different screens and each is worth explaining when you first reach it).

/** The app-wide walkthrough opened from the navbar's "?". */
export const APP_TOUR_KEY = "guided-tour-seen";

/**
 * The review workspace's tour. Keyed per mode: the Create tab's generated
 * preview and the calendar's Preview Mode are different enough — one proposes
 * sets, the other edits real ones — that seeing one shouldn't count as having
 * been shown the other.
 */
export function scheduleTourKey(mode: "generate" | "preview"): string {
  return `schedule-tour-seen:${mode}`;
}

/** Whether this browser has already been shown the tour. Unknown reads false. */
export function hasSeenTour(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    // Storage unavailable — treat it as "seen" so a browser that can never
    // record the flag doesn't reopen the tour on every single visit.
    return true;
  }
}

/** Remember that it has been shown, whether it was finished or skipped. */
export function markTourSeen(key: string): void {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // Ignore — worst case the tour opens once more next visit.
  }
}
