// PATCH /api/platform/orgs/[id] — rename an org and/or rotate its join key.
// Super-admin only. (No DELETE yet — removing an org cascades to all its data,
// so that stays a deliberate manual DB action for now.)
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await requireSuperAdmin())) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => ({}));

  const data: { name?: string; joinKey?: string } = {};
  if (typeof body.name === "string" && body.name.trim()) {
    data.name = body.name.trim();
  }
  // rotateKey:true mints a fresh key; or pass an explicit joinKey string.
  if (body.rotateKey === true) {
    data.joinKey = crypto.randomBytes(9).toString("base64url");
  } else if (typeof body.joinKey === "string" && body.joinKey.trim()) {
    data.joinKey = body.joinKey.trim();
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  try {
    const org = await prisma.org.update({
      where: { id },
      data,
      select: { id: true, name: true, joinKey: true },
    });
    return NextResponse.json(org);
  } catch {
    return NextResponse.json(
      { error: "That name or key is already taken." },
      { status: 400 }
    );
  }
}
