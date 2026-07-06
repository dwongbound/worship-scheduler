// POST /api/admin/availability-request — an admin asks the team to enter
// their availability over a date range. The newest one is the active
// request. Admin only.
import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifyAvailabilityRequest } from "@/lib/slack";

// Parse "YYYY-MM-DD" (from <input type=date>) as LOCAL midnight, matching
// app/api/availability's parseLocalDate.
function parseLocalDate(value: string): Date {
  const [y, m, d] = String(value).split("-").map(Number);
  return new Date(y, m - 1, d);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const startDate = parseLocalDate(body.startDate);
  const endDate = parseLocalDate(body.endDate);
  if (
    isNaN(startDate.getTime()) ||
    isNaN(endDate.getTime()) ||
    startDate > endDate
  ) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }

  // Optional custom name; blank/whitespace → null (UI falls back to the range).
  const name =
    typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;

  const request = await prisma.availabilityRequest.create({
    data: { name, startDate, endDate },
  });

  // DM the whole team asking them to fill it in. Non-throwing and a no-op when
  // Slack isn't configured.
  await notifyAvailabilityRequest(request);

  return NextResponse.json(request, { status: 201 });
}
