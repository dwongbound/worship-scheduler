// DELETE /api/access-keys/[id] — revoke one of YOUR keys. It stops working on
// the very next request. The row stays (revokedAt) so the record of the key
// survives; the profile simply stops listing it.
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // Scoped to the caller: somebody else's key id is simply not found.
  const { count } = await prisma.accessKey.updateMany({
    where: { id, userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (count === 0) return NextResponse.json({ error: "No such key." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
