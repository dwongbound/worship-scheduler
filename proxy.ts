// Require login for every page. API routes are excluded here because they
// do their own session checks and should return JSON 401s, not redirects.
import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  // `icon` and `apple-icon` are the GENERATED icon routes (app/icon.tsx,
  // app/apple-icon.tsx) — excluded so the favicon still loads on the
  // logged-out /login screen, which would otherwise redirect the request for
  // it back to /login. Extension-less on purpose: that's the route Next
  // serves a generated icon at, and the names here have to track whatever
  // app/ actually produces. A mismatch is silent — nothing references these
  // paths in code, the favicon just quietly stops loading when signed out.
  // manifest.webmanifest is excluded because phones fetch it without auth
  // cookies when installing the app to the home screen.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon|manifest.webmanifest|apple-icon|login).*)",
  ],
};
