// Everything an access key reads, in ONE answer: the db half of agentView.ts.
// GET /api/agent returns it whole, and the MCP endpoint hands out its sections
// as tools. Reading is read-only: no calendar sync, no Slack, no sweeps. A
// read through a key changes nothing but the key's own "last used".
//
// What the person SEES is the rule for what's here: their orgs' sets through
// the calendar's own visibility filter (`visibleSetsFilter`, with no
// super-admin widening — a key never sees more than membership shows), the
// covers My Sets would offer them (lib/openCovers.ts) and their availability
// requests (lib/notifications.ts). Never another person's email or
// availability.
import { prisma } from "./prisma";
import { getMyOrgIds } from "./org";
import { visibleSetsFilter } from "./sets";
import { openCoversFor } from "./openCovers";
import { availabilityStatus } from "./notifications";
import { getTeamCatalogs } from "./teamRoleStore";
import { agentAvailability, agentCover, agentMySet, agentSet } from "./agentView";
import type { KeyUser } from "./accessKeyAuth";
import { AGENT_SECTIONS, type AgentSection } from "./agentTools";

/** How far ahead the person's own sets are read. */
export const AGENT_MY_SETS_DAYS = 60;
/** How far ahead the whole schedule is read. */
export const AGENT_SCHEDULE_DAYS = 30;

const DAY_MS = 86_400_000;

/** The columns agentView.ts AgentSetRow needs, and nothing else. */
const SET_SELECT = {
  id: true,
  label: true,
  startsAt: true,
  durationMinutes: true,
  teamId: true,
  mdUserId: true,
  org: { select: { name: true } },
  team: { select: { name: true } },
  md: { select: { name: true } },
  assignments: {
    select: {
      id: true,
      role: true,
      status: true,
      userId: true,
      user: { select: { name: true } },
      guestTeam: { select: { teamId: true } },
    },
  },
  songs: { select: { title: true, key: true, order: true } },
  practices: { select: { startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" as const } },
} as const;

/** One section's data, by name — what each MCP tool returns. */
export async function agentSection(user: KeyUser, section: AgentSection, origin: string, now = new Date()) {
  switch (section) {
    case "mySets":
      return readMySets(user, origin, now);
    case "schedule":
      return readSchedule(user, origin, now);
    case "covers":
      return readCovers(user, origin);
    case "availability":
      return readAvailability(user, origin);
  }
}

/** The whole snapshot: who the key belongs to, and every section. */
export async function agentSnapshot(user: KeyUser, origin: string, now = new Date()) {
  const [mySets, schedule, covers, availability] = await Promise.all(
    AGENT_SECTIONS.map((s) => agentSection(user, s, origin, now))
  );
  return {
    generatedAt: now.toISOString(),
    person: { name: user.name },
    mySets,
    schedule,
    covers,
    availability,
  };
}

/**
 * Upcoming sets in the person's orgs that they can see, `days` ahead; with
 * `mine`, only the ones they hold a seat on. Still running counts, so a set
 * that's under way is "what's next" to anyone asking.
 */
async function readSets(user: KeyUser, days: number, mine: boolean, now: Date) {
  const orgIds = await getMyOrgIds(user.id);
  const until = new Date(now.getTime() + days * DAY_MS);
  // A set can't run past a day, so a day back is enough to catch one in progress.
  const from = new Date(now.getTime() - DAY_MS);
  const rows = await prisma.set.findMany({
    where: {
      AND: [
        { orgId: { in: orgIds }, startsAt: { gte: from, lt: until } },
        visibleSetsFilter({ userId: user.id, isSuperAdmin: false }),
        mine ? { assignments: { some: { userId: user.id } } } : {},
      ],
    },
    orderBy: { startsAt: "asc" },
    select: SET_SELECT,
  });
  const upcoming = rows.filter((r) => r.startsAt.getTime() + r.durationMinutes * 60_000 > now.getTime());
  const catalogs = await getTeamCatalogs(
    upcoming.flatMap((r) => [r.teamId, ...r.assignments.map((a) => a.guestTeam?.teamId)])
  );
  return { rows: upcoming, catalogs, until };
}

async function readMySets(user: KeyUser, origin: string, now: Date) {
  const { rows, catalogs, until } = await readSets(user, AGENT_MY_SETS_DAYS, true, now);
  return {
    window: { from: now.toISOString(), to: until.toISOString() },
    sets: rows.map((row) => agentMySet(row, catalogs, user.id, origin)),
  };
}

async function readSchedule(user: KeyUser, origin: string, now: Date) {
  const { rows, catalogs, until } = await readSets(user, AGENT_SCHEDULE_DAYS, false, now);
  return {
    window: { from: now.toISOString(), to: until.toISOString() },
    sets: rows.map((row) => agentSet(row, catalogs, user.id, origin)),
  };
}

async function readCovers(user: KeyUser, origin: string) {
  const covers = await openCoversFor(user.id, await getMyOrgIds(user.id));
  const teamIds = covers.map((c) => c.set.teamId);
  const catalogs = await getTeamCatalogs(teamIds);
  const teams = await prisma.team.findMany({
    where: { id: { in: teamIds.filter((id): id is string => !!id) } },
    select: { id: true, name: true },
  });
  const teamNames = new Map(teams.map((t) => [t.id, t.name]));
  return covers.map((cover) => agentCover(cover, catalogs, teamNames, origin));
}

async function readAvailability(user: KeyUser, origin: string) {
  const status = await availabilityStatus(user.id);
  return status.items.map((item) => agentAvailability(item, origin));
}
