// Platform-admin org management (super-admin only): list every org with its
// join key + Slack status, and create new orgs. This replaces editing the
// ORG_KEYS env var + redeploying. Guarded by requireSuperAdmin on every call.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** A short, URL-safe, human-shareable join key. */
function generateKey(): string {
  return crypto.randomBytes(9).toString("base64url"); // ~12 chars
}

export async function GET() {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const orgs = await prisma.org.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      joinKey: true,
      slackTeamName: true,
      slackBotToken: true,
      createdAt: true,
      _count: { select: { memberships: true } },
    },
  });
  return NextResponse.json(
    orgs.map((o) => ({
      id: o.id,
      name: o.name,
      joinKey: o.joinKey,
      memberCount: o._count.memberships,
      slackConnected: !!o.slackBotToken,
      slackTeamName: o.slackTeamName,
    }))
  );
}

export async function POST(req: NextRequest) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const joinKey = String(body.joinKey ?? "").trim() || generateKey();
  if (!name) {
    return NextResponse.json({ error: "Org name is required." }, { status: 400 });
  }
  try {
    const org = await prisma.org.create({
      data: { name, joinKey },
      select: { id: true, name: true, joinKey: true },
    });
    return NextResponse.json(org, { status: 201 });
  } catch {
    // Unique-constraint hit on name or joinKey.
    return NextResponse.json(
      { error: "An org with that name or key already exists." },
      { status: 400 }
    );
  }
}
