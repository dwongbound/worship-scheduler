// Require login for every page. API routes are excluded here because they
// do their own session checks and should return JSON 401s, not redirects.
import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  // icon.png is excluded so the favicon still loads on the logged-out /login
  // screen (otherwise the request for it would itself redirect to /login).
  // It must stay in step with the FILENAME in app/ — this read `icon.svg`
  // when the mark was a drawing, and a rename here is silent: the favicon
  // just quietly 302s to /login for anyone signed out.
  // manifest.webmanifest and apple-icon are excluded because phones fetch
  // them without auth cookies when installing the app to the home screen.
  // tw-logo.png is the Navbar mark, served from public/ — the login page
  // doesn't draw it today, but it costs nothing to keep reachable.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|tw-logo.png|manifest.webmanifest|apple-icon|login).*)",
  ],
};
