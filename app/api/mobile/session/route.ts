// POST /api/mobile/session — the iOS app's sign-in. Username-or-email +
// password in, a bearer token out (lib/mobileToken.ts). Same check as the web
// login form (`verifyCredentials`), so the two can't disagree about who may
// sign in. Signing OUT is the app forgetting its token: there is no server
// state to delete, which is the point of reusing the NextAuth JWT.
import { NextRequest, NextResponse } from "next/server";
import { verifyCredentials } from "@/lib/auth";
import { MOBILE_TOKEN_MAX_AGE_S, mintMobileToken } from "@/lib/mobileToken";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as {
    username?: unknown;
    password?: unknown;
  } | null;
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username.trim() || !password) {
    return NextResponse.json(
      { error: "Enter your username or email and your password" },
      { status: 400 }
    );
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    return NextResponse.json(
      { error: "That username or password isn't right" },
      { status: 401 }
    );
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { userId: user.id },
    select: { orgId: true, isAdmin: true },
  });
  const sessionUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    memberships,
  };
  const token = await mintMobileToken(sessionUser, secret);
  const expiresAt = new Date(Date.now() + MOBILE_TOKEN_MAX_AGE_S * 1000);
  return NextResponse.json({
    token,
    expiresAt: expiresAt.toISOString(),
    user: sessionUser,
  });
}
