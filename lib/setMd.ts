// Server-side helpers that keep a set's designated musical director (MD)
// consistent as its roster changes. The pure MD *rules* live in lib/md.ts;
// these wrap them with the db read/write, so they're server-only (they import
// prisma) and must not be pulled into client bundles.
import { prisma } from "./prisma";
import { eligibleMDIds, isValidMD, type MDAssignment } from "./md";
import { pendingOwners } from "./pendingHandoff";

// Load a set's roster in the shape the MD rules expect — including, for a seat
// mid-handoff, the person it still belongs to (see lib/pendingHandoff.ts), so a
// pending cover or swap doesn't unseat the set's MD before it's approved.
export async function loadForMD(setId: string) {
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: {
      requiresMD: true,
      mdUserId: true,
      assignments: {
        select: {
          id: true,
          userId: true,
          role: true,
          status: true,
          pendingCoverFromUserId: true,
          user: { select: { isMD: true } },
        },
      },
    },
  });
  if (!set) return null;
  const owners = await pendingOwners(set.assignments);
  const roster: MDAssignment[] = set.assignments.map((a) => {
    const owner = owners.get(a.id);
    return {
      userId: a.userId,
      role: a.role,
      isMD: a.user.isMD,
      pendingFrom: owner ? { userId: owner.id, isMD: owner.isMD } : null,
    };
  });
  return { set, roster };
}

/**
 * Drop the set's MD if that person is no longer an eligible assignee (e.g. their
 * MD-capable slot was reassigned away or removed).
 */
export async function clearStaleMD(setId: string) {
  const data = await loadForMD(setId);
  if (!data || !data.set.mdUserId) return;
  if (!isValidMD(data.set.mdUserId, data.roster)) {
    await prisma.set.update({ where: { id: setId }, data: { mdUserId: null } });
  }
}

/**
 * When a required-MD set has no valid MD yet and the person just assigned is now
 * an eligible MD, make them the MD automatically — manual-scheduling parity with
 * auto-schedule, which fills the MD itself. A set that already has a valid MD is
 * left alone, so a deliberate manual pick is never overridden.
 */
export async function promoteMDIfEmpty(setId: string, assignedUserId: string) {
  const data = await loadForMD(setId);
  if (!data || !data.set.requiresMD) return;
  if (isValidMD(data.set.mdUserId, data.roster)) return;
  if (eligibleMDIds(data.roster).includes(assignedUserId)) {
    await prisma.set.update({
      where: { id: setId },
      data: { mdUserId: assignedUserId },
    });
  }
}

/**
 * Re-settle the MD once a handoff is FINAL (an approved cover or swap): the
 * seat has changed hands for real, so the person who left may no longer be a
 * valid MD. `preferUserId` is whoever just landed on the set — they get the job
 * if they qualify, otherwise the best remaining eligible person does (see
 * defaultMDId's preference order). A set that doesn't require an MD just loses
 * a stale designation rather than gaining a new one.
 */
export async function reconcileMD(setId: string, preferUserId?: string) {
  const data = await loadForMD(setId);
  if (!data) return;
  const { set, roster } = data;
  // A still-valid MD is left alone — an approval elsewhere on the set is no
  // reason to move the job.
  if (isValidMD(set.mdUserId, roster)) return;

  // Who takes the job now. Written as plain steps rather than one expression:
  // the order matters (the new arrival first, then the best of the rest) and
  // it's the kind of rule someone will come back to read.
  const eligible = eligibleMDIds(roster);
  let next: string | null = null;
  if (set.requiresMD) {
    if (preferUserId && eligible.includes(preferUserId)) {
      next = preferUserId;
    } else {
      next = eligible[0] ?? null;
    }
  }
  if (next === set.mdUserId) return;
  await prisma.set.update({ where: { id: setId }, data: { mdUserId: next } });
}
