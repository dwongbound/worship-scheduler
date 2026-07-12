// GET /api/sets — sets from the last week through +3 months, with full
// team rosters, across the caller's orgs (?orgId= narrows to one). Powers
// the Calendar tab.
// POST /api/sets — an org admin creates a one-off ("ad-hoc") set from the
// calendar's inline "+" button. Org comes from the set's team.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { resolveOrgScope, requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { validateSlotCapacities } from "@/lib/constants";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const scope = await resolveOrgScope(
    user.id,
    req.nextUrl.searchParams.get("orgId")
  );

  const now = Date.now();
  const sets = await prisma.set.findMany({
    where: {
      orgId: { in: scope },
      startsAt: {
        gte: new Date(now - 7 * MS_PER_DAY),
        lte: new Date(now + 92 * MS_PER_DAY),
      },
    },
    orderBy: { startsAt: "asc" },
    include: {
      org: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      assignments: {
        include: { user: { select: { id: true, name: true, isMD: true } } },
      },
    },
  });

  return NextResponse.json(sets);
}

export async function POST(req: NextRequest) {
  const { label, startsAt, durationMinutes, slotCapacities, requiresMD, teamId } =
    await req.json();

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

  // Every new set targets a team; the team pins down the org, and the caller
  // must be an admin of THAT org.
  if (typeof teamId !== "string" || teamId.length === 0) {
    return NextResponse.json({ error: "Team is required" }, { status: 400 });
  }
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) {
    return NextResponse.json({ error: "Team not found" }, { status: 400 });
  }
  const admin = await requireOrgAdminFor(team.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const set = await prisma.set.create({
    data: {
      label: typeof label === "string" && label.trim() ? label.trim() : null,
      startsAt: start,
      durationMinutes,
      requiresMD: Boolean(requiresMD),
      slotCapacities: capacities ?? undefined,
      teamId,
      orgId: team.orgId,
    },
  });
  return NextResponse.json(set, { status: 201 });
}
