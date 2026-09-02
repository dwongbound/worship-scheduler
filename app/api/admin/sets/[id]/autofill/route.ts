// POST /api/admin/sets/:id/autofill — fill an EXISTING set's empty slots
// (admin only). Triggered by the "Auto schedule" buttons in the set detail
// modal. Body (optional): { guestTeamId?: string }.
//
// SCOPE — the set's own roster and each borrowed ("other team") block have
// their own button, so a run only touches the one you clicked:
//   • no guestTeamId → the OWNING team's slots. Borrowed seats are left alone.
//   • guestTeamId    → only that other team's borrowed seats. The band roster
//                      and the set's MD are left alone.
// The two are independent on purpose: re-rolling the visiting choir shouldn't
// quietly staff the band, and vice versa.
//
// Anyone already assigned is a hard constraint: they keep their slot, they're
// never proposed for a second one, and an MD already seated in an MD role
// satisfies requiresMD. Only the remaining open slots are filled — nothing is
// ever removed or reassigned, in either scope.
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
import { type Instrument, type SlotCapacityMap } from "@/lib/constants";
import { schedulableRolesByTeam } from "@/lib/roster";
import { availableGuestMembers, buildSchedule, teamKey } from "@/lib/scheduler";
import {
  isUnbounded,
  openSeats,
  usersOnSet,
  validateGuestRoles,
} from "@/lib/guestTeams";
import { getTeamCatalog } from "@/lib/teamRoleStore";
import { defaultMDId, isValidMD } from "@/lib/md";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // Which roster to fill. An absent/blank guestTeamId = the set's own team;
  // a value names one of its guest rows (validated against the set below).
  const body = await req.json().catch(() => ({}));
  const guestTeamId =
    typeof body?.guestTeamId === "string" && body.guestTeamId
      ? body.guestTeamId
      : null;
  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      assignments: {
        select: {
          userId: true,
          role: true,
          guestTeamId: true,
          user: { select: { isMD: true } },
        },
      },
      // Borrowed seats are filled after the band, from each guest team's own
      // members — see the guest pass below.
      guestTeams: { select: { id: true, teamId: true, roles: true } },
    },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A scoped run must name one of THIS set's guest rows (the id an assignment's
  // guestTeamId points at) — anything else is a stale or foreign block.
  if (guestTeamId && !set.guestTeams.some((g) => g.id === guestTeamId)) {
    return NextResponse.json(
      { error: "Other team not found on this set" },
      { status: 404 }
    );
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
        // inactive on, so neither the band fill nor a guest seat takes them
        // (an admin can still pick them by hand).
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
    // Upcoming load per user, plus the same rows split by team — the second
    // is what keeps a one-off autofill honouring the per-team balance the
    // generate run works to. One findMany: prisma can't group by a field on
    // the related Set, so the team split has to be tallied here anyway.
    prisma.assignment.findMany({
      where: { set: { startsAt: { gte: new Date() } } },
      select: { userId: true, set: { select: { teamId: true } } },
    }),
  ]);

  const eligible = users.map((u) => ({
    id: u.id,
    isMD: u.isMD,
    rolesByTeam: schedulableRolesByTeam(u.teamMembers),
  }));
  const existingCounts = new Map<string, number>();
  const existingTeamCounts = new Map<string, number>();
  for (const a of existing) {
    existingCounts.set(a.userId, (existingCounts.get(a.userId) ?? 0) + 1);
    const key = teamKey(a.userId, a.set.teamId);
    existingTeamCounts.set(key, (existingTeamCounts.get(key) ?? 0) + 1);
  }

  // Who's booked on the neighboring sets, and when — the spacing signal.
  const booked = neighbors.flatMap((n) =>
    n.assignments.map((a) => ({ userId: a.userId, startsAt: n.startsAt }))
  );

  // Only the OWNING team's seats are pre-assigned constraints: a guest seat
  // belongs to another team's role catalog, so feeding it in would decrement a
  // same-keyed slot on this team's shape that nobody is actually standing in.
  // Guests still can't be double-booked — the guest pass below excludes anyone
  // already on the set, in any seat.
  const schedulerSet = {
    id: set.id,
    startsAt: set.startsAt,
    durationMinutes: set.durationMinutes,
    // Which roles this set has at all, and their default counts — its team's.
    roles: await getTeamCatalog(set.teamId),
    capacities: set.slotCapacities as SlotCapacityMap | null,
    requiresMD: set.requiresMD,
    // Only this set's team members are eligible for the fill.
    teamId: set.teamId,
    // The current BAND roster, verbatim — the fill works around it.
    preAssigned: set.assignments
      .filter((a) => !a.guestTeamId)
      .map((a) => ({
        userId: a.userId,
        role: a.role as Instrument,
        isMD: a.user.isMD,
      })),
  };

  // Skipped entirely on a guest-scoped run: that button only fills the block it
  // sits in, so the band roster (and the MD derived from it) stays untouched.
  const proposals = guestTeamId
    ? []
    : buildSchedule(
        [schedulerSet],
        eligible,
        rules,
        existingCounts,
        booked,
        existingTeamCounts
      );

  // ── Guest teams ────────────────────────────────────────────────────────
  // Each borrowed role is filled from ITS team's members: everyone who plays
  // that role there and is free at this time, minus anyone already on the set.
  // That exclusion is the "smart" part the band fill can't do on its own — a
  // person playing keys for the host team is busy, so the visiting choir skips
  // them rather than double-booking.
  //
  // `allAvailable` seats the whole list; a counted role takes the least-booked
  // few, the same preference the band fill uses. Running tallies build up
  // across roles so one person can't be seated twice in the same pass.
  const seatedSoFar = usersOnSet(set.assignments);
  for (const p of proposals) seatedSoFar.add(p.userId);

  const guestPicks: { userId: string; role: Instrument; guestTeamId: string }[] = [];
  // Unscoped (the main button) fills the set's own roster only — each other
  // team has its own button, so nothing here runs unless it named a row.
  const guestRows = guestTeamId
    ? set.guestTeams.filter((g) => g.id === guestTeamId)
    : [];
  for (const guest of guestRows) {
    const specs = validateGuestRoles(
      guest.roles,
      // Trust what's stored: it was validated against the team's catalog when
      // saved. A role the team has since deleted simply seats nobody.
      Array.isArray(guest.roles)
        ? (guest.roles as { role?: unknown }[])
            .map((r) => r?.role)
            .filter((r): r is string => typeof r === "string")
        : []
    );
    if (!specs) continue;

    for (const spec of specs) {
      const candidates = availableGuestMembers(
        schedulerSet,
        spec.role,
        guest.teamId,
        eligible,
        rules,
        seatedSoFar,
        existingCounts
      );
      // Unbounded → everyone; counted → up to the seats still open.
      const filled = set.assignments.filter(
        (a) => a.role === spec.role && a.guestTeamId === guest.id
      ).length;
      const take = isUnbounded(spec)
        ? candidates.length
        : openSeats(spec, filled);
      for (const userId of candidates.slice(0, take)) {
        guestPicks.push({ userId, role: spec.role, guestTeamId: guest.id });
        seatedSoFar.add(userId);
      }
    }
  }

  // Band picks + borrowed guests, all committed together.
  const newAssignments = [
    ...proposals.map((p) => ({
      userId: p.userId,
      role: p.role,
      guestTeamId: null as string | null,
    })),
    ...guestPicks,
  ];

  // Commit the new picks as PENDING (people still confirm) and log each as
  // auto-scheduled (actorId null → the history shows "Auto-scheduler").
  const { count } = await prisma.assignment.createMany({
    data: newAssignments.map((a) => ({
      setId: set.id,
      userId: a.userId,
      role: a.role,
      // Which guest row seated them (null = the set's own team).
      guestTeamId: a.guestTeamId,
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
  // Only an own-roster run can change who's eligible to lead.
  if (set.requiresMD && !guestTeamId) {
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
