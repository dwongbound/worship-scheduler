// POST /api/mobile/session/social — Google or Apple sign-in from the iOS app.
// Body: { provider: "google" | "apple", idToken, name?, allowDuplicateName? }.
//
// The token is verified first (lib/socialToken.ts) and only then believed;
// lib/socialSignIn.ts decides which account it is. Answers exactly what
// POST /api/mobile/session does, so the app keeps one session shape:
// { token, expiresAt, user }. A name clash answers 409 { nameConflicts } once,
// the same advisory the web's sign-up and Google paths give.
import { NextRequest, NextResponse } from "next/server";
import { MOBILE_TOKEN_MAX_AGE_S, mintMobileToken } from "@/lib/mobileToken";
import { prisma } from "@/lib/prisma";
import { resolveSocialUser } from "@/lib/socialSignIn";
import { audiencesFor, verifySocialToken, type SocialProvider } from "@/lib/socialToken";

const PROVIDERS: SocialProvider[] = ["google", "apple"];

export async function POST(req: NextRequest) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Sign-in is not configured" }, { status: 500 });
  }
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const provider = body?.provider as SocialProvider;
  const idToken = typeof body?.idToken === "string" ? body.idToken : "";
  if (!PROVIDERS.includes(provider) || !idToken) {
    return NextResponse.json({ error: "Missing sign-in details" }, { status: 400 });
  }

  const audiences = audiencesFor(provider);
  if (audiences.length === 0) {
    return NextResponse.json(
      { error: `${provider === "google" ? "Google" : "Apple"} sign-in isn't set up yet.` },
      { status: 503 }
    );
  }
  const identity = await verifySocialToken(provider, idToken, audiences);
  if (!identity) {
    return NextResponse.json(
      { error: "That sign-in didn't go through. Try again." },
      { status: 401 }
    );
  }

  const result = await resolveSocialUser(identity, {
    name: typeof body?.name === "string" ? body.name : null,
    allowDuplicateName: body?.allowDuplicateName === true,
  });
  if (result.kind === "refused") {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  if (result.kind === "conflicts") {
    return NextResponse.json(
      { error: "An account with that name already exists.", nameConflicts: result.conflicts },
      { status: 409 }
    );
  }

  const memberships = await prisma.orgMembership.findMany({
    where: { userId: result.user.id },
    select: { orgId: true, isAdmin: true },
  });
  const sessionUser = {
    id: result.user.id,
    name: result.user.name,
    email: result.user.email,
    memberships,
  };
  const token = await mintMobileToken(sessionUser, secret);
  return NextResponse.json({
    token,
    expiresAt: new Date(Date.now() + MOBILE_TOKEN_MAX_AGE_S * 1000).toISOString(),
    user: sessionUser,
  });
}
