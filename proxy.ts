// Require login for every page. API routes are excluded here because they
// do their own session checks and should return JSON 401s, not redirects.
import { withAuth } from "next-auth/middleware";

export const proxy = withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|login).*)"],
};
