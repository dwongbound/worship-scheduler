// GET /api/google-calendar/import/authorize?requestId= — the iOS app's way
// into the import's one-time Google consent. The web follows GET /import (a
// redirect, carried by its cookie); the app authenticates with a bearer token
// a browser sheet can't send, so it asks for the URL here and opens it itself.
// The state is marked mobile, so the callback returns to tapworship:// .
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { importAuthorizeUrl } from "@/lib/googleAvailability";
import { guardImport } from "../guard";

export async function GET(req: NextRequest) {
  const guard = await guardImport(req.nextUrl.searchParams.get("requestId"));
  if (!guard.ok) return guard.response;
  const { email } = (await prisma.user.findUnique({
    where: { id: guard.userId },
    select: { email: true },
  })) ?? { email: null };
  return NextResponse.json({ url: importAuthorizeUrl(guard.userId, guard.requestId, email, true) });
}
