// DELETE /api/admin/templates/:id — org admin only (org derived from the
// template itself).
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const template = await prisma.setTemplate.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(template.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.setTemplate.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
