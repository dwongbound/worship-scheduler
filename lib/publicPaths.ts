// Which pages a signed-out stranger may read, and which render bare.
//
// Three places used to carry their own copy of this list — AuthGate (does the
// client render this page or bounce to /login?), Navbar and SwipePager (is
// there any app chrome here?) — and proxy.ts a fourth at the edge. They drifted
// the moment the public home page was added: the edge let "/" through and the
// client still bounced it to /login, which is exactly the login wall the page
// existed to remove, and the bounce only shows in a browser.
//
// So the readings live here, named, and proxy.ts is the one copy left (it runs
// at the edge, where this module's imports can't follow).
import { LEGAL_LINKS } from "./legal";

/** The public home page (app/page.tsx). */
export const HOME_PATH = "/";

/**
 * Readable with no account: the home page, the sign-in screen and the two
 * legal pages. Google's OAuth verification fetches all four with no account,
 * which is the reason three of them are public at all.
 *
 * "/" is public even though a signed-IN visitor never sees it — proxy.ts
 * redirects them to /calendar at the edge.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === HOME_PATH) return true;
  if (pathname === "/login" || pathname.startsWith("/login/")) return true;
  return LEGAL_LINKS.some((l) => pathname === l.href);
}

/**
 * Renders without the app's chrome — no navbar, no tab swipe. Every public
 * page, plus /join: you're signed in there, but you have no organization yet,
 * so there is nothing for the tabs to show.
 */
export function isChromelessPath(pathname: string): boolean {
  return pathname === "/join" || isPublicPath(pathname);
}
