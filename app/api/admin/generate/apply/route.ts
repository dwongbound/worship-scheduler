// POST /api/admin/generate/apply — commit a reviewed schedule (admin only).
// Body: StagedPlan (the possibly-edited plan from POST /api/admin/generate).
//
// This is the ONLY step that writes: for each staged set it creates the Set
// row if it doesn't exist yet, then inserts its roster as PENDING assignments
// (users are prompted to confirm on their next visit). Duplicate assignments
// are skipped so re-applying is safe.
//
// NOTE: this is the hook point for notifications — once email/Slack land,
// they fire here (never during the dry-run preview), so nobody is messaged
// until the admin actually applies.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  SLOT_CAPACITIES,
  validateSlotCapacities,
  type Instrument,
} from "@/lib/constants";
import type { StagedPlan, StagedSet } from "@/lib/types";

// Light validation of one staged set from the request body. Returns a
// normalized set, or null to skip anything malformed (admin-only route, so
// this is a guardrail, not a security boundary).
function parseStagedSet(raw: unknown): StagedSet | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;

  const startsAt = new Date(String(s.startsAt));
  if (Number.isNaN(startsAt.getTime())) return null;

  const durationMinutes = Number(s.durationMinutes);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  // slotCapacities may be null (default shape) or a valid partial map.
  let slotCapacities: StagedSet["slotCapacities"] = null;
  if (s.slotCapacities != null) {
    slotCapacities = validateSlotCapacities(s.slotCapacities);
    if (slotCapacities === null) return null;
  }

  const rawAssignments = Array.isArray(s.assignments) ? s.assignments : [];
  const assignments = rawAssignments
    .map((a) => a as Record<string, unknown>)
    .filter(
      (a) =>
        typeof a.userId === "string" &&
        typeof a.role === "string" &&
        a.role in SLOT_CAPACITIES
    )
    .map((a) => ({ userId: a.userId as string, role: a.role as Instrument }));

  return {
    startsAt: startsAt.toISOString(),
    label: typeof s.label === "string" ? s.label : null,
    durationMinutes,
    requiresMD: Boolean(s.requiresMD),
    mdUserId: typeof s.mdUserId === "string" ? s.mdUserId : null,
    slotCapacities,
    teamId: typeof s.teamId === "string" ? s.teamId : null,
    existing: Boolean(s.existing),
    assignments,
  };
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => null)) as StagedPlan | null;
  const rawSets = Array.isArray(body?.sets) ? body!.sets : null;
  if (!rawSets) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const sets = rawSets
    .map(parseStagedSet)
    .filter((s): s is StagedSet => s !== null);

  // Resolve the plan's team ids against THIS ORG's teams once; a team deleted
  // (or belonging to another org) degrades to "no team" instead of failing.
  const knownTeamIds = new Set(
    (
      await prisma.team.findMany({
        where: { orgId: admin.orgId },
        select: { id: true },
      })
    ).map((t) => t.id)
  );
  const teamIdOf = (s: StagedSet) =>
    s.teamId && knownTeamIds.has(s.teamId) ? s.teamId : null;

  // Only this org's members may appear on rosters — anything else in the
  // (client-supplied) plan is dropped, same spirit as the team-id guard.
  const memberIds = new Set(
    (
      await prisma.orgMembership.findMany({
        where: { orgId: admin.orgId },
        select: { userId: true },
      })
    ).map((m) => m.userId)
  );

  let setsCreated = 0;
  let assignmentsCreated = 0;

  for (const s of sets) {
    const startsAt = new Date(s.startsAt);

    const roster = s.assignments.filter((a) => memberIds.has(a.userId));
    // Honor the reviewed MD choice, but only if that person is actually in the
    // roster being applied (else leave it unset — the detail modal re-validates
    // full eligibility on display).
    const rosterIds = new Set(roster.map((a) => a.userId));
    const mdUserId =
      s.requiresMD && s.mdUserId && rosterIds.has(s.mdUserId)
        ? s.mdUserId
        : null;

    // Reuse an existing set with the same name at this time, else create it —
    // so we never recreate a block that already exists (and never fill a
    // differently-named set that happens to share the time).
    let set = await prisma.set.findFirst({
      where: { orgId: admin.orgId, startsAt, label: s.label ?? null },
    });
    if (!set) {
      set = await prisma.set.create({
        data: {
          label: s.label ?? undefined,
          startsAt,
          durationMinutes: s.durationMinutes,
          requiresMD: s.requiresMD,
          mdUserId,
          slotCapacities: s.slotCapacities ?? undefined,
          teamId: teamIdOf(s),
          orgId: admin.orgId,
        },
      });
      setsCreated++;
    } else {
      // Reused set: bring its shape/flags in line with the plan so an
      // empty existing row doesn't keep stale requiresMD/capacities/duration.
      set = await prisma.set.update({
        where: { id: set.id },
        data: {
          durationMinutes: s.durationMinutes,
          requiresMD: s.requiresMD,
          mdUserId,
          slotCapacities: s.slotCapacities ?? undefined,
          teamId: teamIdOf(s),
        },
      });
    }

    if (roster.length > 0) {
      const result = await prisma.assignment.createMany({
        data: roster.map((a) => ({
          setId: set!.id,
          userId: a.userId,
          role: a.role,
          status: "PENDING" as const,
        })),
        // The @@unique([setId, userId, role]) guards against a person landing
        // in the same role twice on a set (e.g. re-apply, or an existing set
        // already partly staffed) — skip rather than error.
        skipDuplicates: true,
      });
      assignmentsCreated += result.count;
    }
  }

  // TODO: once email/Slack integration lands, notify the newly-assigned users
  // here — this is the moment the schedule becomes "real".

  return NextResponse.json({ setsCreated, assignmentsCreated });
}
