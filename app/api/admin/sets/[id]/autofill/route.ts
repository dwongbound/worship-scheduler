// POST /api/admin/sets/:id/autofill — fill an EXISTING set's empty slots
// (admin only). Triggered by "Auto schedule" in the set detail modal.
//
// Anyone already assigned is a hard constraint: they keep their slot, they're
// never proposed for a second one, and an MD already seated in an MD role
// satisfies requiresMD. Only the remaining open slots are filled.
//
// This WRITES: new assignments are created immediately as PENDING and logged
// to the set's history as auto-scheduled (no actor).
//
// Spacing: bookings on NEIGHBORING sets are fed to the scheduler's soft
// spacing rule, so people who just served (or serve again soon) are picked
// last — but still picked when nobody else can cover a slot.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { CHOIR, type Instrument, type SlotCapacityMap } from "@/lib/constants";
import { schedulableRolesByTeam } from "@/lib/roster";
import { availableChoirMembers, buildSchedule } from "@/lib/scheduler";
import { defaultMDId, isValidMD } from "@/lib/md";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      assignments: {
        select: { userId: true, role: true, user: { select: { isMD: true } } },
      },
    },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Fetch bookings within the spacing window either side of this set — they
  // feed buildSchedule's soft "served too recently" preference.
  const windowStart = new Date(set.startsAt.getTime() - 8 * MS_PER_DAY);
  const windowEnd = new Date(set.startsAt.getTime() + 8 * MS_PER_DAY);

  const [users, rules, neighbors, existing] = await Promise.all([
    // Candidate pool = the set's org's members (a null teamId then means
    // "open to everyone in the org", not everyone in the app).
    prisma.user.findMany({
      where: { memberships: { some: { orgId: set.orgId } } },
      select: {
        id: true,
        isMD: true,
        // Per-team roles: only this org's teams are relevant to this set;
        // schedulableRolesByTeam then drops the memberships they're marked
        // inactive on, so neither the band fill nor the choir seats them (an
        // admin can still pick them by hand).
        teamMembers: {
          where: { team: { orgId: set.orgId } },
          select: { teamId: true, roles: true, active: true },
        },
      },
    }),
    // Unscoped on purpose: busy blocks are global to the person.
    prisma.unavailability.findMany(),
    // OTHER sets near this time, with just their rosters — to know who's busy
    // (this set's own people are constraints, not "busy", so exclude it).
    prisma.set.findMany({
      where: { id: { not: id }, startsAt: { gte: windowStart, lte: windowEnd } },
      select: { startsAt: true, assignments: { select: { userId: true } } },
    }),
    // Upcoming load per user, so ties still favor the least-scheduled.
    prisma.assignment.groupBy({
      by: ["userId"],
      where: { set: { startsAt: { gte: new Date() } } },
      _count: true,
    }),
  ]);

  const eligible = users.map((u) => ({
    id: u.id,
    isMD: u.isMD,
    rolesByTeam: schedulableRolesByTeam(u.teamMembers),
  }));
  const existingCounts = new Map(existing.map((e) => [e.userId, e._count]));

  // Who's booked on the neighboring sets, and when — the spacing signal.
  const booked = neighbors.flatMap((n) =>
    n.assignments.map((a) => ({ userId: a.userId, startsAt: n.startsAt }))
  );

  // The scheduler only fills the capacity-bearing band roles, so choir
  // assignments are NOT fed in as pre-assigned constraints (they'd wrongly block
  // a choir singer from also being scheduled on their band role). Choir is
  // seated separately, below.
  const schedulerSet = {
    id: set.id,
    startsAt: set.startsAt,
    durationMinutes: set.durationMinutes,
    capacities: set.slotCapacities as SlotCapacityMap | null,
    requiresMD: set.requiresMD,
    // Only this set's team members are eligible for the fill.
    teamId: set.teamId,
    // The current BAND roster, verbatim — the fill works around it.
    preAssigned: set.assignments
      .filter((a) => a.role !== CHOIR)
      .map((a) => ({
        userId: a.userId,
        role: a.role as Instrument,
        isMD: a.user.isMD,
      })),
  };

  const proposals = buildSchedule(
    [schedulerSet],
    eligible,
    rules,
    existingCounts,
    booked
  );

  // Choir: seat everyone on the team who's free at this time and isn't already
  // on this set's choir. Unbounded — no capacity, spacing, or load balancing.
  // Only when the set has choir turned on (opt-in per set); otherwise skip it.
  const alreadyOnChoir = new Set(
    set.assignments.filter((a) => a.role === CHOIR).map((a) => a.userId)
  );
  const choirUserIds = set.choirEnabled
    ? availableChoirMembers(schedulerSet, eligible, rules, alreadyOnChoir)
    : [];

  // Band picks + choir singers, all committed together.
  const newAssignments = [
    ...proposals.map((p) => ({ userId: p.userId, role: p.role })),
    ...choirUserIds.map((userId) => ({ userId, role: CHOIR as Instrument })),
  ];

  // Commit the new picks as PENDING (people still confirm) and log each as
  // auto-scheduled (actorId null → the history shows "Auto-scheduler").
  const { count } = await prisma.assignment.createMany({
    data: newAssignments.map((a) => ({
      setId: set.id,
      userId: a.userId,
      role: a.role,
      status: "PENDING" as const,
    })),
    skipDuplicates: true,
  });
  if (newAssignments.length > 0) {
    await prisma.setHistoryEvent.createMany({
      data: newAssignments.map((a) => ({
        setId: set.id,
        role: a.role,
        targetUserId: a.userId,
        type: "ADDED" as const,
      })),
    });
  }

  // Designate an MD from the full post-fill roster: keep the current one if it's
  // still eligible, otherwise auto-pick the best (see lib/md.ts).
  if (set.requiresMD) {
    const isMDById = new Map<string, boolean>(
      users.map((u: { id: string; isMD: boolean }) => [u.id, u.isMD])
    );
    const fullRoster = [
      ...set.assignments.map((a) => ({
        userId: a.userId,
        role: a.role as Instrument,
        isMD: a.user.isMD,
      })),
      ...proposals.map((p) => ({
        userId: p.userId,
        role: p.role,
        isMD: isMDById.get(p.userId) ?? false,
      })),
    ];
    const mdUserId = isValidMD(set.mdUserId, fullRoster)
      ? set.mdUserId
      : defaultMDId(fullRoster);
    if (mdUserId !== set.mdUserId) {
      await prisma.set.update({ where: { id: set.id }, data: { mdUserId } });
    }
  }

  return NextResponse.json({ assignmentsCreated: count });
}
