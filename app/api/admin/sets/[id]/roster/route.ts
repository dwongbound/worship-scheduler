// PATCH /api/admin/sets/:id/roster — apply a whole roster diff in ONE request.
//
// The set detail modal stages its edits and commits them on Save. It used to
// commit them one HTTP call at a time — a DELETE per removed seat, a PATCH per
// reassignment, a POST per addition — so auto-filling an empty set meant eight
// sequential round trips, eight transactions, and eight separate Slack messages
// for what the admin did in one click.
//
// This endpoint takes the diff whole (see lib/setDraft.ts diffAssignments,
// which produces exactly this shape):
//
//   { removed: [assignmentId], reassigned: [{id, userId}], added: [{role, userId, guestTeamId?}] }
//
// It validates EVERYTHING before writing anything, applies the lot in one
// transaction, and posts a single grouped notice to the set's group chat. The
// per-person DMs stay per person — each is about one seat, and the people
// affected each need their own.
//
// The validation and writes live in lib/rosterDiff.ts, shared with the batch
// PUT /api/admin/sets/roster (calendar Preview Mode saves many sets at once).
//
// All-or-nothing is a deliberate change from the old behaviour, where a failure
// halfway through left the earlier calls applied and the rest not. A stale
// modal (someone else edited the roster first) now changes nothing and says so.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import {
  isEmptyOps,
  isRosterError,
  parseRosterOps,
  prepareRosterDiff,
  rosterAftermath,
  rosterSaveError,
  rosterWrites,
  ROSTER_TX_TIMEOUT_MS,
} from "@/lib/rosterDiff";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: setId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid roster change" }, { status: 400 });
  }
  const ops = parseRosterOps(body);

  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: { orgId: true, teamId: true },
  });
  if (!set) {
    return NextResponse.json({ error: "Set not found" }, { status: 404 });
  }
  const admin = await requireOrgAdminFor(set.orgId);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Nothing to do — answer without opening a transaction or saying anything on
  // Slack. The modal calls this whenever the roster section was touched at all,
  // including edits that cancelled themselves out.
  if (isEmptyOps(ops)) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  const prepared = await prepareRosterDiff(setId, set, ops, admin.user.id);
  if (isRosterError(prepared)) {
    return NextResponse.json(
      { error: prepared.error },
      { status: prepared.status }
    );
  }

  // One transaction: either the whole save lands or none of it does.
  try {
    await prisma.$transaction(rosterWrites([prepared]), {
      timeout: ROSTER_TX_TIMEOUT_MS,
    });
  } catch (err) {
    // The admin gets a sentence; the log gets the database's own error, which
    // names the set, the person and the role — without it in the log there is
    // nothing to go on when a save fails in production.
    console.error("[roster] save failed", { setId, error: err });
    const fail = rosterSaveError(err);
    return NextResponse.json({ error: fail.error }, { status: fail.status });
  }

  await rosterAftermath(prepared);
  return NextResponse.json({ ok: true, applied: prepared.changes.length });
}
