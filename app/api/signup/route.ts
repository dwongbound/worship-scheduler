// POST /api/signup — self-service account creation with the credentials
// provider. Body: { firstName, lastName, email, password, orgKey? }. The email
// doubles as the login username.
//
// Two paths, chosen by whether the email already has a row:
//
//   New email      → create an ordinary account, exactly as before.
//   PLACEHOLDER    → CLAIM that row (see lib/accountClaim): keep its id, and
//                    with it the org membership, availability and form response
//                    an admin imported for this person before they had an
//                    account. Requires `orgKey`, because a placeholder is
//                    already inside an org — see the guard below.
//   Real account   → rejected as a duplicate, exactly as before.
//
// Orthogonal to all three: a NAME that already exists (any address) gets one
// 409 warning naming that account, which the login page turns into a popup.
// See lib/nameConflict — it's advisory, and `allowDuplicateName` overrides it.
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { claimPlaceholder, findUserByEmail } from "@/lib/accountClaim";
import { findNameConflicts } from "@/lib/nameConflictStore";
import { ensureOrgsSynced } from "@/lib/org";
import { prisma } from "@/lib/prisma";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const firstName = String(body.firstName ?? "").trim();
  const lastName = String(body.lastName ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const orgKey = String(body.orgKey ?? "").trim();
  // Set by the login page after the person has SEEN the "an account already
  // exists under this name" warning and said it isn't them.
  const allowDuplicateName = body.allowDuplicateName === true;

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

  const passwordHash = bcrypt.hashSync(password, 10);
  const existing = await findUserByEmail(email);

  if (existing?.isPlaceholder) {
    // An imported placeholder already carries its org membership, so claiming
    // one would otherwise walk straight past the /join key gate that every
    // other new account has to clear. Ask for the key here instead: the roster
    // is a list of real, guessable email addresses, and the key is the only
    // thing proving the person asking actually belongs to the org.
    //
    // Google sign-in claims the same row without a key on purpose — Google has
    // already proved the person owns that address, which is stronger evidence
    // than the shared key.
    if (!orgKey) {
      return NextResponse.json(
        {
          error:
            "Your team has already set up an account for this email. " +
            "Enter your organization key to claim it.",
          needsOrgKey: true,
        },
        { status: 403 }
      );
    }
    if (!(await keyUnlocks(existing.id, orgKey))) {
      return NextResponse.json(
        {
          error: "That key doesn't match your organization.",
          needsOrgKey: true,
        },
        { status: 403 }
      );
    }
    await claimPlaceholder(existing.id, {
      name: `${firstName} ${lastName}`,
      passwordHash,
    });
    return NextResponse.json({ ok: true, claimed: true }, { status: 200 });
  }

  // Same name, different address? Stop once and show them who we found — this
  // is almost always the same person with a second email, and going through
  // creates a twin that splits their history. They can still say "not me" and
  // resubmit with allowDuplicateName; two people really can share a name.
  if (!allowDuplicateName) {
    const nameConflicts = await findNameConflicts(
      `${firstName} ${lastName}`,
      email
    );
    if (nameConflicts.length > 0) {
      return NextResponse.json(
        {
          error: "An account with that name already exists.",
          nameConflicts,
        },
        { status: 409 }
      );
    }
  }

  try {
    await prisma.user.create({
      data: {
        name: `${firstName} ${lastName}`,
        email,
        username: email, // let people sign in with their email
        passwordHash,
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

/**
 * Does this key open one of the orgs the placeholder was imported into? Any
 * other org's key — even a real one — is refused, so a key you legitimately
 * hold for org A can't be used to claim a stranger's row in org B.
 */
async function keyUnlocks(userId: string, key: string): Promise<boolean> {
  // Backfills env-declared orgs/keys first, exactly as redeemOrgKey does.
  await ensureOrgsSynced();
  const org = await prisma.org.findFirst({
    where: { joinKey: key },
    select: { id: true },
  });
  if (!org) return false;
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId, orgId: org.id } },
    select: { id: true },
  });
  return !!membership;
}
