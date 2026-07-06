// POST /api/signup — self-service account creation with the credentials
// provider. Body: { firstName, lastName, email, password }. The email
// doubles as the login username.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");

  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "First and last name are required." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`,
        email,
        username: email, // let people sign in with their email
        passwordHash: bcrypt.hashSync(password, 10),
        instruments: [],
      },
    });
  } catch {
    // Unique-constraint hit on email/username.
    return NextResponse.json(
      { error: "An account with that email already exists." },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
