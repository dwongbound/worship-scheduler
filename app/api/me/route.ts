// GET /api/me — current user's editable profile fields.
// PUT /api/me — update them (password only if provided).
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SLOT_CAPACITIES } from "@/lib/constants";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      username: true,
      name: true,
      email: true,
      slackUserId: true,
      instruments: true,
    },
  });

  return NextResponse.json(me);
}

export async function PUT(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Only accept known instrument values.
  const validInstruments = Object.keys(SLOT_CAPACITIES);
  const instruments = Array.isArray(body.instruments)
    ? body.instruments.filter((i: string) => validInstruments.includes(i))
    : [];

  const data: Record<string, unknown> = {
    name: body.name.trim(),
    email: body.email || null,
    slackUserId: body.slackUserId || null,
    instruments,
  };
  if (typeof body.password === "string" && body.password.length > 0) {
    if (body.password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }
    data.passwordHash = bcrypt.hashSync(body.password, 10);
  }

  try {
    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
      select: { name: true, email: true, slackUserId: true, instruments: true },
    });
    return NextResponse.json(updated);
  } catch {
    // Most likely a unique-constraint hit on email/slackUserId.
    return NextResponse.json(
      { error: "Email or Slack ID already in use" },
      { status: 400 }
    );
  }
}
