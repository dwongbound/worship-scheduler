// DELETE /api/admin/reminders/:id — remove a scheduled weekly reminder. The
// org is derived from the reminder, then admin of THAT org is required.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const reminder = await prisma.weeklyReminder.findUnique({
    where: { id },
    select: { orgId: true },
  });
  if (!reminder) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(reminder.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.weeklyReminder.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
