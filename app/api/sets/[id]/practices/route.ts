// POST /api/sets/:id/practices — add one practice to a set. Org admin only.
//
// A practice is an extra calendar event for the people already on this set, on
// ANY date: it is normally the one a recurring time handed down, but it can be
// dropped on any set at any time, before or after the set itself. Body is
// { startsAt, endsAt } — two instants, never a length (see lib/practices.ts).
//
// Deliberately NOT here: a roster. Who gets invited is derived from the set's
// assignments when the event is synced, so a roster change carries the invite
// with it.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { validateSetPractice } from "@/lib/practices";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const set = await prisma.set.findUnique({
    where: { id },
    select: { orgId: true, practices: { select: { startsAt: true } } },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  if (!(await requireOrgAdminFor(set.orgId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const check = validateSetPractice(
    body,
    set.practices.map((p) => p.startsAt)
  );
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const practice = await prisma.setPractice.create({
    data: {
      setId: id,
      startsAt: check.practice.startsAt,
      endsAt: check.practice.endsAt,
    },
    select: { id: true, startsAt: true, endsAt: true },
  });
  return NextResponse.json(practice, { status: 201 });
}
