// DELETE /api/sets/:id/practices/:practiceId — drop one practice. Org admin
// only; the org is derived from the set the practice hangs off, and the
// practice must belong to THAT set (so an id from another set can't be used to
// delete across orgs).
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const { id, practiceId } = await params;
  const practice = await prisma.setPractice.findUnique({
    where: { id: practiceId },
    select: { setId: true, set: { select: { orgId: true } } },
  });
  if (!practice || practice.setId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(practice.set.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.setPractice.delete({ where: { id: practiceId } });
  return NextResponse.json({ ok: true });
}
