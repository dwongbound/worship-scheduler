// Server-side helpers that keep a set's designated musical director (MD)
// consistent as its roster changes. The pure MD *rules* live in lib/md.ts;
// these wrap them with the db read/write, so they're server-only (they import
// prisma) and must not be pulled into client bundles.
import { prisma } from "./prisma";
import { eligibleMDIds, isValidMD, type MDAssignment } from "./md";

// Load a set's roster in the shape the MD rules expect.
async function loadForMD(setId: string) {
  const set = await prisma.set.findUnique({
    where: { id: setId },
    select: {
      requiresMD: true,
      mdUserId: true,
      assignments: {
        select: { userId: true, role: true, user: { select: { isMD: true } } },
      },
    },
  });
  if (!set) return null;
  const roster: MDAssignment[] = set.assignments.map((a) => ({
    userId: a.userId,
    role: a.role,
    isMD: a.user.isMD,
  }));
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
