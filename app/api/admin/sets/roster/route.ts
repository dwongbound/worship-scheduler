// PUT /api/admin/sets/roster — apply roster diffs to MANY sets in one request.
//
// The calendar's Preview Mode edits every set in view at once (Auto schedule,
// Clear all…), then saves the lot. Doing that as a PATCH per set meant a failure
// halfway left half the plan saved. This takes the whole batch:
//
//   { sets: [{ setId, removed, reassigned, added, mdUserId? }] }
//
// (each item's ops are the per-set PATCH's body — lib/setDraft.ts
// diffAssignments). Every set is validated first, then ALL the roster writes
// land in ONE transaction, so the batch is all-or-nothing. The aftermath — MD
// fixups and one group-chat notice per set — runs per set once it's in, and
// then ONE DM per person summarising every set the batch touched for them.
//
// `mdUserId` (string, or null to clear) is applied last, against the finished
// roster, exactly as PATCH /api/sets/[id] { mdUserId } checks it. An MD that
// the new roster makes ineligible can't roll the roster back, so it's reported
// in `mdRejected` instead of failing the request.
import { NextRequest, NextResponse } from "next/server";
import { isValidMD } from "@/lib/md";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  DUPLICATE_SEAT,
  INVALID_ROSTER,
  isEmptyOps,
  isRosterError,
  parseRosterOps,
  prepareRosterDiff,
  rosterAftermath,
  rosterDms,
  type PreparedRoster,
} from "@/lib/rosterDiff";
import { notifyRosterChanges } from "@/lib/slack";
import { loadForMD } from "@/lib/setMd";

// A generate window is a few months of weekly sets; this is well past that and
// still bounds one request's transaction.
const MAX_SETS = 200;

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const raw: unknown[] = Array.isArray(body?.sets) ? body.sets : [];
  if (raw.length === 0 || raw.length > MAX_SETS) {
    return NextResponse.json(INVALID_ROSTER, { status: 400 });
  }

  const items: {
    setId: string;
    ops: ReturnType<typeof parseRosterOps>;
    md?: string | null;
  }[] = [];
  for (const r of raw) {
    const item = r as { setId?: unknown; mdUserId?: unknown };
    if (!item || typeof item.setId !== "string") {
      return NextResponse.json(INVALID_ROSTER, { status: 400 });
    }
    const hasMD = "mdUserId" in item;
    if (hasMD && item.mdUserId !== null && typeof item.mdUserId !== "string") {
      return NextResponse.json({ error: "Invalid mdUserId" }, { status: 400 });
    }
    items.push({
      setId: item.setId,
      ops: parseRosterOps(item),
      ...(hasMD ? { md: item.mdUserId as string | null } : {}),
    });
  }
  if (new Set(items.map((i) => i.setId)).size !== items.length) {
    return NextResponse.json(INVALID_ROSTER, { status: 400 });
  }

  // Every set must exist and belong to ONE org, the one the caller admins.
  const sets = await prisma.set.findMany({
    where: { id: { in: items.map((i) => i.setId) } },
    select: { id: true, orgId: true, teamId: true },
  });
  if (sets.length !== items.length) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const orgIds = new Set(sets.map((s) => s.orgId));
  if (orgIds.size !== 1) {
    return NextResponse.json(INVALID_ROSTER, { status: 400 });
  }
  const admin = await requireOrgAdminFor(sets[0].orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const setById = new Map(sets.map((s) => [s.id, s]));

  // ── Validate every set before writing any ──────────────────────────────
  const prepared: PreparedRoster[] = [];
  for (const item of items) {
    if (isEmptyOps(item.ops)) continue;
    const p = await prepareRosterDiff(
      item.setId,
      setById.get(item.setId)!,
      item.ops,
      admin.user.id
    );
    if (isRosterError(p)) {
      return NextResponse.json(
        { error: p.error, setId: item.setId },
        { status: p.status }
      );
    }
    prepared.push(p);
  }

  if (prepared.length > 0) {
    try {
      await prisma.$transaction(prepared.flatMap((p) => p.writes));
    } catch (err) {
      // See the single-set route: the admin gets the sentence, the log gets
      // the database's own message, which is the only thing that names the
      // seat that failed.
      console.error("[roster] batch save failed", {
        setIds: prepared.map((p) => p.setId),
        error: err,
      });
      return NextResponse.json(DUPLICATE_SEAT, { status: DUPLICATE_SEAT.status });
    }
    for (const p of prepared) await rosterAftermath(p, { sendDms: false });
    // ONE DM per person across the whole batch: filling a month of one role
    // used to send each person a message per set.
    await notifyRosterChanges(sets[0].orgId, rosterDms(prepared));
  }

  // ── MD picks, against the finished rosters ─────────────────────────────
  const mdRejected: string[] = [];
  let mdApplied = 0;
  for (const item of items) {
    if (item.md === undefined) continue;
    if (item.md !== null) {
      const data = await loadForMD(item.setId);
      if (!isValidMD(item.md, data?.roster ?? [])) {
        mdRejected.push(item.setId);
        continue;
      }
    }
    await prisma.set.update({
      where: { id: item.setId },
      data: { mdUserId: item.md },
    });
    mdApplied++;
  }

  return NextResponse.json({
    ok: true,
    applied: prepared.reduce((n, p) => n + p.changes.length, 0),
    sets: prepared.length,
    mdApplied,
    mdRejected,
  });
}
