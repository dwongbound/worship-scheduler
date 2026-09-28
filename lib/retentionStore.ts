// The prisma half of data retention — the sweep itself. The vocabulary (the
// offered windows, the cutoff maths, the cadence) is in lib/retention.ts.
//
// What a sweep deletes, per org, is deliberately just two statements:
//
//   Set                  startsAt < cutoff
//   AvailabilityRequest  endDate  < cutoff
//
// Everything else goes with them through the cascades already declared in the
// schema — a set takes its assignments, songs, guest teams, activity log and
// swap proposals; a request takes its responses and the dated blocks people
// filled in for it. That's the whole point of doing it this way: there is no
// second list of tables here to fall out of step with the schema.
//
// Never touched: people, teams, memberships, role catalogs, recurring set
// types, and the weekly repeats in someone's availability. Those describe the
// workspace as it is now, not what it did in the past.
import { prisma } from "./prisma";
import { pruneDue, retentionCutoff } from "./retention";

/** What a sweep deleted (or would delete). */
export interface PruneCounts {
  sets: number;
  requests: number;
}

/** The fuller picture the confirmation dialog shows before an admin commits. */
export interface PrunePreview extends PruneCounts {
  /** ISO date of the oldest moment kept — everything before it goes. */
  cutoff: string;
  /** Cascaded rows, counted so the warning can be specific rather than vague. */
  assignments: number;
  historyEvents: number;
  responses: number;
}

/**
 * What switching this org to `months` would delete, counted rather than
 * deleted. Runs on demand (an admin opening the confirmation), so it can
 * afford to count the cascaded rows the sweep itself doesn't bother with.
 */
export async function previewOrgPrune(
  orgId: string,
  months: number,
  now: Date = new Date()
): Promise<PrunePreview> {
  const cutoff = retentionCutoff(months, now);
  const oldSets = { orgId, startsAt: { lt: cutoff } };
  const oldRequests = { orgId, endDate: { lt: cutoff } };

  const [sets, assignments, historyEvents, requests, responses] =
    await Promise.all([
      prisma.set.count({ where: oldSets }),
      prisma.assignment.count({ where: { set: oldSets } }),
      prisma.setHistoryEvent.count({ where: { set: oldSets } }),
      prisma.availabilityRequest.count({ where: oldRequests }),
      prisma.availabilityResponse.count({ where: { request: oldRequests } }),
    ]);

  return {
    cutoff: cutoff.toISOString(),
    sets,
    assignments,
    historyEvents,
    requests,
    responses,
  };
}

/**
 * Delete everything past this org's cutoff. One transaction, so a failure
 * halfway can't leave sets gone and their requests kept.
 */
export async function pruneOrg(
  orgId: string,
  months: number,
  now: Date = new Date()
): Promise<PruneCounts> {
  const cutoff = retentionCutoff(months, now);
  const [sets, requests] = await prisma.$transaction([
    prisma.set.deleteMany({ where: { orgId, startsAt: { lt: cutoff } } }),
    prisma.availabilityRequest.deleteMany({
      where: { orgId, endDate: { lt: cutoff } },
    }),
  ]);
  return { sets: sets.count, requests: requests.count };
}

/**
 * Sweep every org that's due one, and stamp it — including orgs where nothing
 * was old enough to delete, so a quiet workspace isn't re-counted every night.
 *
 * Called from the daily cron. Orgs are swept one at a time rather than in
 * parallel: this is bulk deletion on a shared database and there is no hurry.
 */
export async function runDuePrunes(
  now: Date = new Date()
): Promise<{ swept: number; sets: number; requests: number }> {
  const orgs = await prisma.org.findMany({
    select: { id: true, retentionMonths: true, lastPrunedAt: true },
  });

  let swept = 0;
  let sets = 0;
  let requests = 0;
  for (const org of orgs) {
    if (!pruneDue(org.lastPrunedAt, now)) continue;
    const counts = await pruneOrg(org.id, org.retentionMonths, now);
    await prisma.org.update({
      where: { id: org.id },
      data: { lastPrunedAt: now },
    });
    swept++;
    sets += counts.sets;
    requests += counts.requests;
  }
  return { swept, sets, requests };
}
