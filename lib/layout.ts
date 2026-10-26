// Layout breakpoints shared between CSS and JS.
//
// Tailwind owns the responsive classes, but three touch behaviours have to
// agree with them in JavaScript (the tab-swipe pager, pull-to-refresh, and
// anything else gated on "is this the app-style layout?"). A number in one
// file and a `lg:` in another drift silently — the bottom nav appears while
// swiping between tabs stops working — so the number lives here and the
// classes that pair with it say so.

/**
 * Below this width the app wears its app-style chrome: the floating bottom
 * nav bar (Navbar), the tab-swipe gesture (SwipePager) and pull-to-refresh.
 * At or above it, the desktop top tab strip takes over and the touch gestures
 * switch off.
 *
 * 1024 = Tailwind's `lg`, so the paired classes are `lg:hidden` / `lg:flex`.
 * Chosen to put every iPad in portrait (768–1024) on the bottom bar: a tablet
 * held in the hand is a phone as far as reaching the navigation goes, and only
 * a laptop-width window gets the top strip.
 */
export const BOTTOM_NAV_MAX_WIDTH = 1024;

/** True when the viewport is in app-style (bottom nav) territory. */
export function isBottomNavWidth(): boolean {
  return window.innerWidth < BOTTOM_NAV_MAX_WIDTH;
}

/**
 * The narrowest viewport the schedule review workspace (the Create tab's
 * generate preview, and the calendar's Preview Mode) is usable at.
 *
 * 768 = Tailwind's `md`, which is the breakpoint the calendar's month grid and
 * its admin toolbar already use: below it the calendar drops to the "My sets"
 * list and the Preview Mode button isn't rendered at all. The workspace is a
 * wide grid of roster cards with drag, hover and keyboard shortcuts, so a
 * phone can't show it — but a tablet (768 in portrait) can, which is why this
 * is `md` and not BOTTOM_NAV_MAX_WIDTH.
 *
 * The button being absent is enough for someone browsing, but a `?draft=` link
 * is made to be pasted into a message and will be opened on a phone. That is
 * the one way in that has to say no for itself.
 */
export const PREVIEW_MIN_WIDTH = 768;

/** True when the viewport is wide enough for the review workspace. */
export function isPreviewWidth(): boolean {
  return window.innerWidth >= PREVIEW_MIN_WIDTH;
}
