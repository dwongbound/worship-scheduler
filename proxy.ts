// Require login for every page. API routes are excluded here because they
// do their own session checks and should return JSON 401s, not redirects.
//
// "/" is the one path with two answers: signed out it's the PUBLIC home page
// (app/page.tsx), signed in it's the app, so the middleware body below sends
// a session holder on to /calendar before that page renders. That redirect
// lives here rather than in next.config.js or an RSC `redirect()` in the page:
// a config redirect can't read the session, and an RSC redirect on "/" crashes
// production hydration with React #310 for an AUTHENTICATED visitor (see
// vercel/next.js#63121) — which is exactly who lands there, since Google's
// sign-in callback defaults to "/".
import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export const proxy = withAuth(
  function onRequest(req) {
    if (req.nextUrl.pathname === "/" && req.nextauth.token) {
      return NextResponse.redirect(new URL("/calendar", req.url));
    }
    return NextResponse.next();
  },
  {
    pages: {
      signIn: "/login",
    },
    callbacks: {
      // The gate. "/" is public — everything else still needs a session, and
      // returning false is what sends it to the sign-in page.
      authorized: ({ req, token }) => req.nextUrl.pathname === "/" || !!token,
    },
  }
);

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
  //
  // `privacy` and `terms` are the two PUBLIC pages (app/privacy, app/terms):
  // Google's OAuth verification fetches them with no account, so behind the
  // login they'd be a redirect to /login as far as it's concerned. The home
  // page is public too, but it is NOT excluded here — it has to reach the
  // middleware so a signed-in visitor can be sent on to the app; the
  // `authorized` callback above is what lets a stranger through.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon|manifest.webmanifest|apple-icon|login|privacy|terms).*)",
  ],
};
