// GET /api/swaps/candidates?assignmentId=<mine>&skip=<n>&take=<n>
// The sets I could TRADE one of my assignments into: upcoming sets on the SAME
// team, in the SAME role, currently held by someone else. One row per such
// assignment (the counterparty's slot), soonest first, offset-paginated for
// the infinite-scroll swap picker.
//
// Each row carries both-direction availability so the requester sees the whole
// picture before proposing:
//   youAvailable  — am I free for THEIR set's date (I'd take it)?
//   theyAvailable — are they free for MY set's date (they'd take it)?
//                   One flag whatever the shape of the block: a standing
//                   weekly rule and a date they typed into an availability
//                   response both mean "they've said they can't".
//   theyInactive  — are they marked inactive on this team (still swappable,
//                   but flagged so you know they've stepped back)?
//   theyAlsoOnYourSet / youAlsoOnTheirSet — roles either side ALREADY holds on
//                   the other's set. A person can legitimately play two roles
//                   on one set, so this never blocks the trade; it's flagged
//                   because accepting would quietly hand someone a double
//                   shift they never asked for (see lib/sets.ts §5). This is
//                   the picker's RED warning — an availability block is an
//                   intention, but a seat they already hold is a fact.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { inactiveMemberIds } from "@/lib/roster";
import { rolesHeldOn, seatIndex } from "@/lib/sets";
import {
  isUserAvailable,
  type SchedulerSet,
  type UnavailabilityRule,
} from "@/lib/scheduler";

const DEFAULT_TAKE = 20;

export async function GET(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const assignmentId = req.nextUrl.searchParams.get("assignmentId");
  if (!assignmentId) {
    return NextResponse.json(
      { error: "assignmentId is required" },
      { status: 400 }
    );
  }
  const skip = Math.max(0, Number(req.nextUrl.searchParams.get("skip")) || 0);
  const take = Math.min(
    50,
    Number(req.nextUrl.searchParams.get("take")) || DEFAULT_TAKE
  );

  // My assignment — the slot I'm offering. Must be mine.
  const mine = await prisma.assignment.findUnique({
    where: { id: assignmentId },
    include: {
      set: {
        select: {
          id: true,
          startsAt: true,
          durationMinutes: true,
          orgId: true,
          teamId: true,
        },
      },
    },
  });
  if (!mine || mine.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Candidate counterparty slots: same role, same org + team, someone else's,
  // on a different upcoming set, and not already frozen in another trade. We
  // also skip sets where I already hold this role (a swap there would collide
  // with the setId+userId+role unique key).
  const [mySeats, myRoster, counterparts] = await Promise.all([
    // EVERY seat I hold on an upcoming set of this team — not just ones in the
    // traded role. The role filter answers "which sets are ineligible"; the
    // rest answer "which would double-book me" (lib/sets.ts §5). Candidates
    // are all upcoming sets on this org + team, so scoping the query the same
    // way keeps it to the handful of rows that can possibly match.
    prisma.assignment.findMany({
      where: {
        userId: user.id,
        set: {
          orgId: mine.set.orgId,
          teamId: mine.set.teamId,
          startsAt: { gte: new Date() },
        },
      },
      select: { setId: true, userId: true, role: true },
    }),
    // My set's whole roster — who else is already on the set I'm offering.
    prisma.assignment.findMany({
      where: { setId: mine.setId },
      select: { setId: true, userId: true, role: true },
    }),
    prisma.assignment.findMany({
      where: {
        role: mine.role,
        userId: { not: user.id },
        status: { not: "PENDING_SWAP" },
        setId: { not: mine.setId },
        set: {
          orgId: mine.set.orgId,
          teamId: mine.set.teamId, // null matches null (team-less sets)
          startsAt: { gte: new Date() },
        },
      },
      include: {
        user: { select: { id: true, name: true } },
        set: {
          select: {
            id: true,
            label: true,
            startsAt: true,
            durationMinutes: true,
            teamId: true,
            team: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ set: { startsAt: "asc" } }, { id: "asc" }],
    }),
  ]);

  // Sets I already play THIS role on → can't swap into them.
  const mySetIds = new Set(
    mySeats.filter((a) => a.role === mine.role).map((a) => a.setId)
  );
  const eligible = counterparts.filter((c) => !mySetIds.has(c.setId));

  // The two "already sitting there" lookups, indexed once for the whole page.
  const mySeatsIndex = seatIndex(mySeats);
  const myRosterIndex = seatIndex(myRoster);

  // Page the eligible list (offset paging is plenty for infinite scroll here).
  const page = eligible.slice(skip, skip + take);
  const hasMore = eligible.length > skip + take;

  // Availability needs unavailability rules for me + everyone shown on this
  // page. Busy blocks are global to the person, so one query covers all orgs.
  const userIds = [user.id, ...page.map((c) => c.user.id)];
  const [blocks, memberships] = await Promise.all([
    prisma.unavailability.findMany({
      where: { userId: { in: userIds } },
      select: {
        userId: true,
        type: true,
        dayOfWeek: true,
        startMinute: true,
        endMinute: true,
        startDate: true,
        endDate: true,
        exceptDates: true, // days freed out of a weekly rule
      },
    }),
    // Who on this page is still ACTIVE. Every candidate set shares my set's
    // team, so one lookup covers them all: that team's memberships, or — for a
    // team-less set — any active membership in the org (matching how team-less
    // sets are "open to the whole org").
    prisma.teamMember.findMany({
      where: mine.set.teamId
        ? { teamId: mine.set.teamId, userId: { in: userIds } }
        : { team: { orgId: mine.set.orgId }, userId: { in: userIds } },
      select: { userId: true, active: true },
    }),
  ]);
  const inactiveUserIds = inactiveMemberIds(memberships);
  const rules: UnavailabilityRule[] = blocks.map((b) => ({ ...b }));

  const mySet: SchedulerSet = {
    id: mine.set.id,
    startsAt: mine.set.startsAt,
    durationMinutes: mine.set.durationMinutes,
    teamId: mine.set.teamId,
  };

  const items = page.map((c) => {
    const theirSet: SchedulerSet = {
      id: c.set.id,
      startsAt: c.set.startsAt,
      durationMinutes: c.set.durationMinutes,
      teamId: c.set.teamId,
    };
    return {
      toAssignmentId: c.id,
      role: c.role,
      status: c.status,
      counterparty: c.user,
      set: {
        id: c.set.id,
        label: c.set.label,
        startsAt: c.set.startsAt,
        durationMinutes: c.set.durationMinutes,
        team: c.set.team,
      },
      // I'd take their set:
      youAvailable: isUserAvailable(user.id, theirSet, rules),
      // They'd take my set:
      theyAvailable: isUserAvailable(c.user.id, mySet, rules),
      theyInactive: inactiveUserIds.has(c.user.id),
      // Roles they'd be adding MY set's slot on top of. `mine.role` can't be
      // among them (I hold it), but passing it keeps the call honest.
      theyAlsoOnYourSet: rolesHeldOn(
        myRosterIndex,
        mine.setId,
        c.user.id,
        mine.role
      ),
      // …and the mirror: roles I already hold on the set I'd be taking on.
      youAlsoOnTheirSet: rolesHeldOn(mySeatsIndex, c.set.id, user.id),
    };
  });

  return NextResponse.json({ items, hasMore });
}
