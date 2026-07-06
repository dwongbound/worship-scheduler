// GET /api/sets — sets from the last week through +3 months, with full
// team rosters. Powers the Calendar tab.
// POST /api/sets — an admin creates a one-off ("ad-hoc") set from the
// calendar's inline "+" button.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateSlotCapacities } from "@/lib/constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const sets = await prisma.set.findMany({
    where: {
      startsAt: {
        gte: new Date(now - 7 * MS_PER_DAY),
        lte: new Date(now + 92 * MS_PER_DAY),
      },
    },
    orderBy: { startsAt: "asc" },
    include: {
      assignments: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  return NextResponse.json(sets);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { label, startsAt, durationMinutes, slotCapacities } = await req.json();

  // startsAt arrives as an ISO string from the client's date+time inputs.
  const start = new Date(startsAt);
  if (
    (label !== undefined && label !== null && typeof label !== "string") ||
    Number.isNaN(start.getTime()) ||
    typeof durationMinutes !== "number" ||
    durationMinutes <= 0
  ) {
    return NextResponse.json({ error: "Invalid set" }, { status: 400 });
  }

  // slotCapacities is optional; when present it must be a valid role→count map.
  let capacities = null;
  if (slotCapacities !== undefined) {
    capacities = validateSlotCapacities(slotCapacities);
    if (!capacities) {
      return NextResponse.json(
        { error: "Invalid slot capacities" },
        { status: 400 }
      );
    }
  }

  const set = await prisma.set.create({
    data: {
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      startsAt: start,
      durationMinutes,
      slotCapacities: capacities ?? undefined,
    },
  });
  return NextResponse.json(set, { status: 201 });
}
