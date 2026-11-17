// GET /api/sets/:id/practices/:practiceId/availability — who, of this set's
// roster, is free for this practice.
//
// Its own endpoint on purpose: the set detail modal shows a set's practices
// without any availability at all, and this is fetched only once a practice is
// actually clicked. A set can carry several practices and a roster of a dozen
// people, and almost none of that is ever looked at — paying for all of it on
// every set open would be a read nobody asked for.
//
// Readable by an org admin or anyone assigned to the set (the same permission
// the setlist has): it's the people on the set reading about themselves.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { practiceFreeBusy } from "@/lib/practices";
import { isUserAvailable } from "@/lib/scheduler";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; practiceId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id, practiceId } = await params;
  const practice = await prisma.setPractice.findUnique({
    where: { id: practiceId },
    select: {
      setId: true,
      startsAt: true,
      endsAt: true,
      set: {
        select: {
          orgId: true,
          assignments: {
            select: {
              userId: true,
              role: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  if (!practice || practice.setId !== id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = await requireOrgAdminFor(practice.set.orgId);
  const onTheSet = practice.set.assignments.some((a) => a.userId === user.id);
  if (!admin && !onTheSet) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Only the roster's own blocks — there's no reason to read the whole org's.
  const userIds = [...new Set(practice.set.assignments.map((a) => a.userId))];
  const rules = await prisma.unavailability.findMany({
    where: { userId: { in: userIds } },
    // The same narrowed shape the other availability readers ask for —
    // `exceptDates` included, since a weekly rule with the practice's day
    // freed out of it doesn't block anything (lib/scheduler.ts honours it, and
    // a select that forgot it would quietly say "busy").
    select: {
      userId: true,
      type: true,
      dayOfWeek: true,
      startMinute: true,
      endMinute: true,
      startDate: true,
      endDate: true,
      exceptDates: true,
      fromGoogle: true,
    },
  });

  const verdicts = practiceFreeBusy(
    practice.set.assignments,
    { id: practiceId, startsAt: practice.startsAt, endsAt: practice.endsAt },
    rules,
    isUserAvailable
  );

  // Name and roles come from the set, since that IS a practice's roster.
  const nameById = new Map(
    practice.set.assignments.map((a) => [a.userId, a.user.name] as const)
  );
  const rolesById = new Map<string, string[]>();
  for (const a of practice.set.assignments) {
    rolesById.set(a.userId, [...(rolesById.get(a.userId) ?? []), a.role]);
  }

  return NextResponse.json({
    people: verdicts.map((v) => ({
      userId: v.userId,
      name: nameById.get(v.userId) ?? "",
      roles: rolesById.get(v.userId) ?? [],
      free: v.free,
      // The blocks that say otherwise, so the row can show a reason rather
      // than a bare "busy". Empty for anyone free.
      blockedBy: v.blockedBy.map((r) => ({
        type: r.type,
        dayOfWeek: r.dayOfWeek,
        startMinute: r.startMinute,
        endMinute: r.endMinute,
        fromGoogle: r.fromGoogle,
      })),
    })),
  });
}
