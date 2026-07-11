// Require login for every page. API routes are excluded here because they
// do their own session checks and should return JSON 401s, not redirects.
import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  // icon.svg is excluded so the favicon still loads on the logged-out /login
  // screen (otherwise the request for it would itself redirect to /login).
  // manifest.webmanifest and apple-icon are excluded because phones fetch
  // them without auth cookies when installing the app to the home screen.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon|login).*)",
  ],
};
