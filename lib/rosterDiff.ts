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
//
// The diff arrives keyed by SEAT (an assignment row id), but what it means is a
// final roster: who holds which role when the save is done. Those two readings
// come apart whenever the same (person, role) is named twice, which the db
// cannot store — `@@unique([setId, userId, role])` — and the clients can't
// always see: Preview Mode leaves a set's borrowed guest seats out of the card,
// so Auto schedule or a hand pick could seat someone in a role they already
// hold as a guest, and the whole save came back 400.
//
// So the diff is reconciled against the set's WHOLE roster before anything is
// written, by person and role rather than by seat (see `collapseByPersonRole`):
// a seat somebody already holds is kept as it is rather than inserted a second
// time, and the writes are ordered deletes → reassignments → insertions so no
// moment inside the transaction holds a person in one role twice. Rules are
// never consulted — they steer Auto schedule, they don't gate a save.
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

/** One seat as the collapse needs to see it. */
interface RosterSeat {
  id: string;
  role: string;
  userId: string;
  guestTeamId?: string | null;
}

export interface CollapsedOps {
  /** Seats to delete: the ones asked for, plus any collapsed away. */
  removed: string[];
  reassigned: AssignmentOps["reassigned"];
  added: AssignmentOps["added"];
  /**
   * Moves that had to be rebuilt rather than updated: the seat is deleted and
   * inserted again under its new occupant. Only a CYCLE inside one role needs
   * this, and everything downstream reports it as an ordinary reassignment.
   */
  rebuilt: {
    seatId: string;
    userId: string;
    role: string;
    guestTeamId: string | null;
  }[];
  /** Seats deleted because their new occupant already holds the role here. */
  collapsedSeatIds: string[];
  /** Insertions dropped because that person already holds the role here. */
  droppedAdded: AssignmentOps["added"];
}

/**
 * Reads a seat-keyed diff as the final roster it means, against the set's whole
 * roster — borrowed guest seats included, which is the case the clients can't
 * see (lib/calendarPreview.ts leaves them off the card).
 *
 * Nobody can hold one role twice on a set: `@@unique([setId, userId, role])`
 * says so, and that is the only thing here that is genuinely impossible rather
 * than merely unwise. So a seat that would duplicate one the set already keeps
 * is COLLAPSED instead of inserted:
 *
 *   - an insertion for a (person, role) that survives the save is dropped —
 *     they are already there, and the seat they hold keeps its status, its
 *     confirmation and any cover request on it;
 *   - a reassignment whose new occupant already holds that role here deletes
 *     the seat instead, since the admin plainly meant that person to hold the
 *     role once, not for the seat's old occupant to stay.
 *
 * The updates are also ORDERED here. A seat keeps its old occupant until its
 * own update runs, so a straight pass collides halfway through a transaction:
 * in a rotation inside one role (b takes a's seat, c takes b's, a takes c's)
 * there is no seat free to move first, and the database rejects the batch —
 * the 400 a shuffle of a multi-seat role like Audio - Support (4/4) produced.
 * So each update is emitted only once its target (person, role) is free, and
 * where a cycle leaves nothing free, one seat of it is REBUILT instead: delete
 * the row, insert it again under its new occupant. That frees the key the rest
 * of the cycle is waiting on, and costs that one seat its confirmation — which
 * a plain reassignment resets anyway.
 *
 * Returned rather than applied so the caller can order its writes: deletes
 * first, then reassignments, then insertions.
 */
export function collapseByPersonRole(
  ops: AssignmentOps,
  roster: RosterSeat[]
): CollapsedOps {
  const key = (userId: string, role: string) => `${userId}|${role}`;
  const removedIds = new Set(ops.removed);
  const movingSeats = new Set(ops.reassigned.map((r) => r.id));
  const seatById = new Map(roster.map((a) => [a.id, a]));

  // Who holds what once the seats this diff touches are set aside.
  const occupied = new Map<string, string>();
  for (const a of roster) {
    if (removedIds.has(a.id) || movingSeats.has(a.id)) continue;
    occupied.set(key(a.userId, a.role), a.id);
  }

  const collapsedSeatIds: string[] = [];
  const reassigned: AssignmentOps["reassigned"] = [];
  for (const r of ops.reassigned) {
    const seat = seatById.get(r.id);
    // An id that isn't on this set is rejected by the caller's validation; it
    // is passed through here rather than silently swallowed.
    if (!seat) {
      reassigned.push(r);
      continue;
    }
    const k = key(r.userId, seat.role);
    if (occupied.has(k)) {
      collapsedSeatIds.push(r.id);
      continue;
    }
    occupied.set(k, r.id);
    reassigned.push(r);
  }

  // ── Order the updates, breaking any cycle ───────────────────────────────
  // Each surviving seat still holds its old (person, role) until its own update
  // runs, so an update whose target key is still held has to wait for the seat
  // holding it. When nothing can go first, the moves form a cycle.
  const heldBySeat = new Map<string, string>();
  for (const r of reassigned) {
    const seat = seatById.get(r.id);
    if (seat) heldBySeat.set(key(seat.userId, seat.role), r.id);
  }
  const ordered: AssignmentOps["reassigned"] = [];
  const rebuilt: CollapsedOps["rebuilt"] = [];
  let waiting = reassigned;
  while (waiting.length > 0) {
    const free = new Set(
      waiting.filter((r) => {
        const seat = seatById.get(r.id);
        // An unknown id has no role to collide over; the caller rejects it.
        if (!seat) return true;
        return !heldBySeat.has(key(r.userId, seat.role));
      })
    );
    if (free.size === 0) {
      // Every remaining move waits on another one: a cycle. Rebuilding ONE of
      // its seats frees that seat's key and unblocks the rest, so each cycle
      // costs exactly one rebuild however long it is.
      const victim = waiting[0];
      const seat = seatById.get(victim.id)!;
      heldBySeat.delete(key(seat.userId, seat.role));
      rebuilt.push({
        seatId: victim.id,
        userId: victim.userId,
        role: seat.role,
        guestTeamId: seat.guestTeamId ?? null,
      });
      waiting = waiting.filter((r) => r !== victim);
      continue;
    }
    for (const r of free) {
      const seat = seatById.get(r.id);
      if (seat) heldBySeat.delete(key(seat.userId, seat.role));
      ordered.push(r);
    }
    waiting = waiting.filter((r) => !free.has(r));
  }

  const added: AssignmentOps["added"] = [];
  const droppedAdded: AssignmentOps["added"] = [];
  for (const a of ops.added) {
    const k = key(a.userId, a.role);
    if (occupied.has(k)) {
      droppedAdded.push(a);
      continue;
    }
    occupied.set(k, NEW_SEAT);
    added.push(a);
  }

  return {
    removed: [...ops.removed, ...collapsedSeatIds],
    reassigned: ordered,
    added,
    rebuilt,
    collapsedSeatIds,
    droppedAdded,
  };
}

// Stands in for "a seat that doesn't exist yet" in the occupancy map, which
// only ever asks whether a key is taken.
const NEW_SEAT = "+";

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
  // The WHOLE roster, not only the touched seats: the collapse below has to
  // know about seats this diff never mentions, which is exactly where the
  // duplicates came from (a guest seat Preview Mode never showed).
  const roster = await prisma.assignment.findMany({
    where: { setId },
    select: {
      id: true,
      role: true,
      userId: true,
      // A rebuilt seat is inserted again, so a borrowed one has to come back
      // borrowed from the same guest team.
      guestTeamId: true,
      user: { select: { name: true } },
    },
  });
  const rosterById = new Map(roster.map((a) => [a.id, a]));
  const existingById = new Map(
    [...new Set(touchedIds)].flatMap((id) => {
      const a = rosterById.get(id);
      return a ? [[id, a] as const] : [];
    })
  );
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

  // ── Collapse by person and role ─────────────────────────────────────────
  const collapsed = collapseByPersonRole(
    { removed, reassigned, added },
    roster
  );

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

  for (const assignmentId of collapsed.removed) {
    const was = rosterById.get(assignmentId)!;
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

  // Ahead of the updates: dropping the cycle's one seat is what frees the key
  // the rest of the rotation moves into.
  for (const b of collapsed.rebuilt) {
    out.writes.push(prisma.assignment.delete({ where: { id: b.seatId } }));
  }

  for (const r of collapsed.reassigned) {
    const was = rosterById.get(r.id)!;
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

  // A rebuilt seat is a reassignment the database wouldn't let us do in place,
  // so it is written as a delete and an insert but REPORTED as a reassignment:
  // the log, the summary and the DMs say what happened to the people, not how
  // the rows had to move. The delete rides with the deletes above and the
  // insert with the insertions below, which is what frees the key in between.
  for (const b of collapsed.rebuilt) {
    const was = rosterById.get(b.seatId)!;
    out.writes.push(
      prisma.setHistoryEvent.create({
        data: {
          setId,
          role: b.role,
          actorId,
          targetUserId: b.userId,
          previousUserId: was.userId,
          type: "REASSIGNED",
        },
      })
    );
    out.changes.push({
      kind: "reassigned",
      role: b.role,
      name: nameByUserId.get(b.userId)!,
    });
    out.seatedUserIds.push(b.userId);
    out.dms.push({
      userId: was.userId,
      kind: "removed",
      role: b.role,
      catalog: ownCatalog,
    });
    out.dms.push({
      userId: b.userId,
      kind: "added",
      role: b.role,
      catalog: ownCatalog,
    });
    out.writes.push(
      prisma.assignment.create({
        data: {
          setId,
          userId: b.userId,
          role: b.role,
          guestTeamId: b.guestTeamId,
          status: "PENDING",
        },
      })
    );
  }

  for (const a of collapsed.added) {
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
