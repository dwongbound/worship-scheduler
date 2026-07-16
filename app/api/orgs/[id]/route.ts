// GET  /api/orgs/[id] — the org's join key (org admins only; others get 403).
// PATCH /api/orgs/[id] — rotate the join key (`rotateKey:true`) or set an
// explicit one (`joinKey:"…"`). Org-admin gated via requireOrgAdminFor, so a
// regular org admin can manage their own key without super-admin/platform.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminFor } from "@/lib/org";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const org = await prisma.org.findUnique({
    where: { id },
    select: { id: true, name: true, joinKey: true },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(org);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));

  // rotateKey:true mints a fresh random key; or set an explicit one.
  let joinKey: string;
  if (body.rotateKey === true) {
    joinKey = crypto.randomBytes(9).toString("base64url");
  } else if (typeof body.joinKey === "string" && body.joinKey.trim()) {
    joinKey = body.joinKey.trim();
  } else {
    return NextResponse.json(
      { error: "Provide a new key or set rotateKey: true." },
      { status: 400 }
    );
  }

  try {
    const org = await prisma.org.update({
      where: { id },
      data: { joinKey },
      select: { id: true, name: true, joinKey: true },
    });
    return NextResponse.json(org);
  } catch {
    // The @unique on Org.joinKey means a collision lands here.
    return NextResponse.json(
      { error: "That key is already taken — try another." },
      { status: 400 }
    );
  }
}
