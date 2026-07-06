// PATCH /api/admin/users/:id — an admin edits another user's admin flag
// and/or their instruments (roles). Admin only.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SLOT_CAPACITIES } from "@/lib/constants";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();

  // Only apply the fields that were actually sent, and validate them.
  // Record<string, unknown> keeps Prisma's enum typing off our back (the
  // instrument strings are validated against SLOT_CAPACITIES below).
  const data: Record<string, unknown> = {};

  if (typeof body.isAdmin === "boolean") {
    data.isAdmin = body.isAdmin;
  }

  if (Array.isArray(body.instruments)) {
    const validInstruments = Object.keys(SLOT_CAPACITIES);
    data.instruments = body.instruments.filter((i: string) =>
      validInstruments.includes(i)
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        isAdmin: true,
        instruments: true,
        scheduleCompletedAt: true,
      },
    });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
}
