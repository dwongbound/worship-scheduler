// The prisma side of a roster diff — the
//
//   { removed: [assignmentId], reassigned: [{id, userId}], added: [{role, userId, guestTeamId?}] }
//
// body lib/setDraft.ts diffAssignments produces. Split in two so a caller can
// validate several sets before writing any of them:
//
//   prepareRosterDiff  — checks EVERYTHING and returns the writes (unexecuted
//                        prisma promises) plus what the aftermath needs, or an
//                        error. Writes nothing.
//   rosterAftermath    — the MD fixups, the one grouped group-chat notice and
//                        the per-person DMs, run once the writes have landed.
//
// PATCH /api/admin/sets/[id]/roster runs one of these in its own transaction;
// PUT /api/admin/sets/roster (the calendar Preview Mode's Save) runs a whole
// plan's worth in ONE transaction, so the batch is all-or-nothing too.
import type { Prisma } from "./generated/prisma/client";
import { prisma } from "./prisma";
import { clearStaleMD, promoteMDIfEmpty } from "./setMd";
import { describeRosterChanges, type RosterChange } from "./rosterChanges";
import { notifyRosterChanges, notifySetChange, type SeatChange } from "./slack";
import { syncSetsAfterResponse } from "./googleCalendar";
import { roleLabel, type TeamRoleDef } from "./teamRoles";
import { getTeamCatalog, getTeamCatalogs } from "./teamRoleStore";
import type { AssignmentOps } from "./setDraft";

export type RosterError = { error: string; status: number };

export interface PreparedRoster {
  setId: string;
  orgId: string;
  // Unexecuted prisma writes, for the caller's $transaction.
  writes: Prisma.PrismaPromise<unknown>[];
  changes: RosterChange[];
  // Who to DM once the writes land, gathered here so the aftermath doesn't have
  // to reconstruct "which person was this change about" from the summary.
  dms: {
    userId: string;
    kind: "added" | "removed";
    role: string;
    catalog: TeamRoleDef[];
  }[];
  // Everyone newly seated by this save — the MD promotion considers them.
  seatedUserIds: string[];
  ownCatalog: TeamRoleDef[];
}

export const INVALID_ROSTER: RosterError = {
  error: "Invalid roster change",
  status: 400,
};

/** Reads the three op lists out of a request body, dropping malformed items. */
export function parseRosterOps(body: unknown): AssignmentOps {
  const b = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >;
  const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  return {
    removed: list(b.removed).filter((v): v is string => typeof v === "string"),
    reassigned: list(b.reassigned).filter(
      (r): r is AssignmentOps["reassigned"][number] =>
        !!r &&
        typeof (r as { id?: unknown }).id === "string" &&
        typeof (r as { userId?: unknown }).userId === "string"
    ),
    added: list(b.added).filter((a): a is AssignmentOps["added"][number] => {
      const x = a as { role?: unknown; userId?: unknown; guestTeamId?: unknown };
      return (
        !!a &&
        typeof x.role === "string" &&
        typeof x.userId === "string" &&
        (x.guestTeamId == null || typeof x.guestTeamId === "string")
      );
    }),
  };
}

export function isEmptyOps(ops: AssignmentOps): boolean {
  return (
    ops.removed.length === 0 &&
    ops.reassigned.length === 0 &&
    ops.added.length === 0
  );
}

export async function prepareRosterDiff(
  setId: string,
  set: { orgId: string; teamId: string | null },
  { removed, reassigned, added }: AssignmentOps,
  actorId: string
): Promise<PreparedRoster | RosterError> {
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
    return {
      error:
        "This set's roster changed while you were editing. Reopen it and try again.",
      status: 409,
    };
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
  if (nameByUserId.size !== incomingUserIds.length) return INVALID_ROSTER;

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
    if (a.guestTeamId && !guestTeamById.has(a.guestTeamId)) return INVALID_ROSTER;
    if (!catalogFor(a.guestTeamId).some((r) => r.key === a.role)) {
      return INVALID_ROSTER;
    }
  }

  // ── Build the writes ────────────────────────────────────────────────────
  // The history rows go in the same transaction, so the log can't disagree
  // with the roster.
  const out: PreparedRoster = {
    setId,
    orgId: set.orgId,
    writes: [],
    changes: [],
    dms: [],
    seatedUserIds: [],
    ownCatalog,
  };

  for (const assignmentId of removed) {
    const was = existingById.get(assignmentId)!;
    out.writes.push(prisma.assignment.delete({ where: { id: assignmentId } }));
    out.writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: was.role,
          actorId,
          targetUserId: was.userId,
          type: "REMOVED",
        },
      })
    );
    out.changes.push({ kind: "removed", role: was.role, name: was.user.name });
    out.dms.push({
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
    out.writes.push(
      prisma.assignment.update({
        where: { id: r.id },
        data: { userId: r.userId, status: "PENDING" },
      })
    );
    out.writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: was.role,
          actorId,
          targetUserId: r.userId,
          previousUserId: was.userId,
          type: "REASSIGNED",
        },
      })
    );
    out.changes.push({
      kind: "reassigned",
      role: was.role,
      name: nameByUserId.get(r.userId)!,
    });
    out.seatedUserIds.push(r.userId);
    // A reassignment is a removal and an addition from the two people's point
    // of view, so both get their own DM about their own seat.
    out.dms.push({
      userId: was.userId,
      kind: "removed",
      role: was.role,
      catalog: ownCatalog,
    });
    out.dms.push({
      userId: r.userId,
      kind: "added",
      role: was.role,
      catalog: ownCatalog,
    });
  }

  for (const a of added) {
    out.writes.push(
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
    out.writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: a.role,
          actorId,
          targetUserId: a.userId,
          type: "ADDED",
        },
      })
    );
    out.changes.push({
      kind: "added",
      role: a.role,
      name: nameByUserId.get(a.userId)!,
    });
    out.seatedUserIds.push(a.userId);
    out.dms.push({
      userId: a.userId,
      kind: "added",
      role: a.role,
      catalog: catalogFor(a.guestTeamId),
    });
  }

  return out;
}

export async function rosterAftermath(
  p: PreparedRoster,
  opts: { sendDms?: boolean } = {}
): Promise<void> {
  // The MD fixups run ONCE over the finished roster rather than per seat: the
  // old per-request flow re-evaluated them after every single change, which
  // could promote someone only to clear them again on the next call.
  await clearStaleMD(p.setId);
  for (const userId of new Set(p.seatedUserIds)) {
    await promoteMDIfEmpty(p.setId, userId);
  }

  // One group-chat notice for the whole save, in place of the message-per-change
  // the old flow produced.
  const notice = describeRosterChanges(p.changes, (role) =>
    roleLabel(role, p.ownCatalog)
  );
  if (notice) await notifySetChange(p.setId, notice);
  syncSetsAfterResponse(p.setId);

  // DMs: one per person for this set. A caller saving MANY sets passes
  // `sendDms: false` and sends rosterDms() across the whole batch itself, so
  // someone touched on ten sets gets one message, not ten.
  if (opts.sendDms !== false) await notifyRosterChanges(p.orgId, rosterDms([p]));
}

/** Every DM a batch of prepared rosters owes, for one notifyRosterChanges. */
export function rosterDms(prepared: PreparedRoster[]): SeatChange[] {
  return prepared.flatMap((p) => p.dms.map((d) => ({ ...d, setId: p.setId })));
}

export function isRosterError(
  r: PreparedRoster | RosterError
): r is RosterError {
  return "error" in r;
}

// The realistic transaction failure is the unique [setId, userId, role] — the
// diff would seat someone twice in one role. Nothing was written.
export const DUPLICATE_SEAT: RosterError = {
  error: "That person is already in this role on this set.",
  status: 400,
};
