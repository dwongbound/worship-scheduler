// GET /api/admin/users — everyone's instruments + whether they've finished
// entering availability (the "scheduling completed" log for admins).
import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      isAdmin: true,
      instruments: true,
      scheduleCompletedAt: true,
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(users);
}
