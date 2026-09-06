// POST /api/auth/allow-duplicate-name — "that other account isn't me, sign me
// in anyway" for the GOOGLE path.
//
// The credentials signup carries its override in the request body, but a Google
// sign-in is a browser redirect we never get to add a field to: the check lives
// in the NextAuth signIn callback, which sees only the OAuth profile. So the
// login page's "Continue anyway" calls this first, and the callback reads the
// short-lived cookie it drops.
//
// The cookie holds the EMAIL it was granted for, so consent covers exactly the
// account the person was warned about — not whichever Google account happens to
// sign in during the next few minutes.
import { NextRequest, NextResponse } from "next/server";
import { DUPLICATE_NAME_COOKIE } from "@/lib/nameConflict";

// Long enough to finish an OAuth round trip (including a password + 2FA
// prompt), short enough that it can't linger as a standing override.
const MAX_AGE_SECONDS = 5 * 60;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(DUPLICATE_NAME_COOKIE, email, {
    httpOnly: true,
    // Lax still sends the cookie on the top-level GET that Google redirects
    // back through, which is the one request that has to see it.
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return res;
}
