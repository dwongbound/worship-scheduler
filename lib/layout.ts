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
