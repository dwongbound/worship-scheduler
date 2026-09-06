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
// All-or-nothing is a deliberate change from the old behaviour, where a failure
// halfway through left the earlier calls applied and the rest not. A stale
// modal (someone else edited the roster first) now changes nothing and says so.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { clearStaleMD, promoteMDIfEmpty } from "@/lib/setMd";
import { describeRosterChanges, type RosterChange } from "@/lib/rosterChanges";
import { notifyAssignmentChange, notifySetChange } from "@/lib/slack";
import { roleLabel } from "@/lib/teamRoles";
import { getTeamCatalog, getTeamCatalogs } from "@/lib/teamRoleStore";
import type { TeamRoleDef } from "@/lib/teamRoles";

interface Reassignment {
  id: string;
  userId: string;
}
interface Addition {
  role: string;
  userId: string;
  guestTeamId?: string | null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: setId } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid roster change" }, { status: 400 });
  }

  const removed: string[] = Array.isArray(body.removed)
    ? body.removed.filter((v: unknown) => typeof v === "string")
    : [];
  const reassigned: Reassignment[] = Array.isArray(body.reassigned)
    ? body.reassigned.filter(
        (r: Reassignment) =>
          r && typeof r.id === "string" && typeof r.userId === "string"
      )
    : [];
  const added: Addition[] = Array.isArray(body.added)
    ? body.added.filter(
        (a: Addition) =>
          a &&
          typeof a.role === "string" &&
          typeof a.userId === "string" &&
          (a.guestTeamId == null || typeof a.guestTeamId === "string")
      )
    : [];

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
  if (removed.length === 0 && reassigned.length === 0 && added.length === 0) {
    return NextResponse.json({ ok: true, applied: 0 });
  }

  // ── Validate ────────────────────────────────────────────────────────────
  // Everything is checked before the first write, so a bad item rejects the
  // whole diff rather than leaving the roster half-changed.

  // The seats being deleted/reassigned must still exist ON THIS SET. Matching
  // by set (not just by id) is also what stops one set's ids being used to edit
  // another's.
  const touchedIds = [...removed, ...reassigned.map((r) => r.id)];
  const existing = await prisma.assignment.findMany({
    where: { id: { in: touchedIds }, setId },
    select: {
      id: true,
      role: true,
      userId: true,
      user: { select: { name: true } },
    },
  });
  const existingById = new Map(existing.map((a) => [a.id, a]));
  if (existingById.size !== new Set(touchedIds).size) {
    // Someone else changed this roster while the modal was open.
    return NextResponse.json(
      {
        error:
          "This set's roster changed while you were editing. Reopen it and try again.",
      },
      { status: 409 }
    );
  }

  // Everyone being seated must belong to the set's org. One query for the lot.
  const incomingUserIds = [
    ...new Set([...reassigned.map((r) => r.userId), ...added.map((a) => a.userId)]),
  ];
  const members = await prisma.orgMembership.findMany({
    where: { orgId: set.orgId, userId: { in: incomingUserIds } },
    select: { userId: true, user: { select: { name: true } } },
  });
  const nameByUserId = new Map(members.map((m) => [m.userId, m.user.name]));
  if (nameByUserId.size !== incomingUserIds.length) {
    return NextResponse.json({ error: "Invalid roster change" }, { status: 400 });
  }

  // Borrowed seats point at a SetGuestTeam row, which must belong to this set —
  // otherwise another set's guest row could smuggle in an unrelated team's
  // roles. Roles are per-team, so each addition is checked against the catalog
  // of whichever team the seat belongs to: the guest's, or the set's own.
  const guestRows = await prisma.setGuestTeam.findMany({
    where: { setId },
    select: { id: true, teamId: true },
  });
  const guestTeamById = new Map(guestRows.map((g) => [g.id, g.teamId]));

  const ownCatalog = await getTeamCatalog(set.teamId);
  const guestCatalogs = await getTeamCatalogs(
    added
      .map((a) => (a.guestTeamId ? guestTeamById.get(a.guestTeamId) : null))
      .filter((t): t is string => !!t)
  );
  const catalogFor = (guestTeamId: string | null | undefined): TeamRoleDef[] => {
    if (!guestTeamId) return ownCatalog;
    const teamId = guestTeamById.get(guestTeamId);
    return (teamId && guestCatalogs.get(teamId)) || ownCatalog;
  };

  for (const a of added) {
    if (a.guestTeamId && !guestTeamById.has(a.guestTeamId)) {
      return NextResponse.json({ error: "Invalid roster change" }, { status: 400 });
    }
    if (!catalogFor(a.guestTeamId).some((r) => r.key === a.role)) {
      return NextResponse.json({ error: "Invalid roster change" }, { status: 400 });
    }
  }

  // ── Apply ───────────────────────────────────────────────────────────────
  // One transaction: either the whole save lands or none of it does. The
  // history rows go in with it, so the log can't disagree with the roster.
  const changes: RosterChange[] = [];
  // Who to DM once the writes land, gathered here so the aftermath doesn't have
  // to reconstruct "which person was this change about" from the summary.
  const dms: {
    userId: string;
    kind: "added" | "removed";
    role: string;
    catalog: TeamRoleDef[];
  }[] = [];
  // Everyone newly seated by this save — the MD promotion below considers them.
  const seatedUserIds: string[] = [];
  const writes = [];

  for (const assignmentId of removed) {
    const was = existingById.get(assignmentId)!;
    writes.push(prisma.assignment.delete({ where: { id: assignmentId } }));
    writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: was.role,
          actorId: admin.user.id,
          targetUserId: was.userId,
          type: "REMOVED",
        },
      })
    );
    changes.push({ kind: "removed", role: was.role, name: was.user.name });
    dms.push({
      userId: was.userId,
      kind: "removed",
      role: was.role,
      catalog: ownCatalog,
    });
  }

  for (const r of reassigned) {
    const was = existingById.get(r.id)!;
    // A reassignment always resets to PENDING: the new person hasn't agreed yet,
    // even if the seat was confirmed by whoever held it.
    writes.push(
      prisma.assignment.update({
        where: { id: r.id },
        data: { userId: r.userId, status: "PENDING" },
      })
    );
    writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: was.role,
          actorId: admin.user.id,
          targetUserId: r.userId,
          previousUserId: was.userId,
          type: "REASSIGNED",
        },
      })
    );
    changes.push({
      kind: "reassigned",
      role: was.role,
      name: nameByUserId.get(r.userId)!,
    });
    seatedUserIds.push(r.userId);
    // A reassignment is a removal and an addition from the two people's point
    // of view, so both get their own DM about their own seat.
    dms.push({
      userId: was.userId,
      kind: "removed",
      role: was.role,
      catalog: ownCatalog,
    });
    dms.push({
      userId: r.userId,
      kind: "added",
      role: was.role,
      catalog: ownCatalog,
    });
  }

  for (const a of added) {
    writes.push(
      prisma.assignment.create({
        data: {
          setId,
          userId: a.userId,
          role: a.role,
          guestTeamId: a.guestTeamId ?? null,
          status: "PENDING",
        },
      })
    );
    writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: a.role,
          actorId: admin.user.id,
          targetUserId: a.userId,
          type: "ADDED",
        },
      })
    );
    changes.push({
      kind: "added",
      role: a.role,
      name: nameByUserId.get(a.userId)!,
    });
    seatedUserIds.push(a.userId);
    dms.push({
      userId: a.userId,
      kind: "added",
      role: a.role,
      catalog: catalogFor(a.guestTeamId),
    });
  }

  try {
    await prisma.$transaction(writes);
  } catch {
    // The realistic failure is the unique [setId, userId, role] — the diff would
    // seat someone twice in one role. Nothing was written.
    return NextResponse.json(
      { error: "That person is already in this role on this set." },
      { status: 400 }
    );
  }

  // ── Aftermath ───────────────────────────────────────────────────────────
  // The MD fixups run ONCE over the finished roster rather than per seat: the
  // old per-request flow re-evaluated them after every single change, which
  // could promote someone only to clear them again on the next call.
  await clearStaleMD(setId);
  for (const userId of new Set(seatedUserIds)) {
    await promoteMDIfEmpty(setId, userId);
  }

  // One group-chat notice for the whole save, in place of the message-per-change
  // the old flow produced.
  const notice = describeRosterChanges(changes, (role) =>
    roleLabel(role, ownCatalog)
  );
  if (notice) await notifySetChange(setId, notice);

  // DMs stay per person: each is about one seat, and only the people affected
  // get one. The group chat may not exist (or may not be in its lead window),
  // so this is the notice they're actually guaranteed to see.
  for (const dm of dms) {
    await notifyAssignmentChange(setId, dm.userId, {
      kind: dm.kind,
      role: dm.role,
      catalog: dm.catalog,
    });
  }

  return NextResponse.json({ ok: true, applied: changes.length });
}
