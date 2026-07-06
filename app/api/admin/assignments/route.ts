// POST /api/admin/assignments — an admin manually adds a person to a set in
// a given role. Created as PENDING (they still confirm). Admin only.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SLOT_CAPACITIES } from "@/lib/constants";

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { setId, userId, role } = await req.json();
  if (
    typeof setId !== "string" ||
    typeof userId !== "string" ||
    !Object.keys(SLOT_CAPACITIES).includes(role)
  ) {
    return NextResponse.json({ error: "Invalid assignment" }, { status: 400 });
  }

  try {
    const created = await prisma.assignment.create({
      data: { setId, userId, role, status: "PENDING" },
    });
    return NextResponse.json(created, { status: 201 });
  } catch {
    // Unique [setId, userId] — the person is already on this set.
    return NextResponse.json(
      { error: "That person is already on this set." },
      { status: 400 }
    );
  }
}
