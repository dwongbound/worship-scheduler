// Server-side access to team role catalogs. The pure vocabulary (defaults,
// ordering, label + capacity resolution) lives in lib/teamRoles.ts; this is the
// thin prisma layer over it, so routes never hand-roll the select.
import { prisma } from "./prisma";
import { DEFAULT_TEAM_ROLES, orderedRoles, type TeamRoleDef } from "./teamRoles";

/** The columns that make up a TeamRoleDef — keep the two in step. */
export const TEAM_ROLE_FIELDS = {
  key: true,
  label: true,
  defaultCount: true,
  adminOnly: true,
  order: true,
} as const;

/**
 * Give a brand-new team the built-in catalog. Every team needs one from the
 * moment it exists — a team with no roles can't staff anything — so this runs
 * as part of creating one. (Teams that predate catalogs were seeded by the
 * migration that introduced the table.)
 */
export async function seedTeamRoles(teamId: string): Promise<void> {
  await prisma.teamRole.createMany({
    data: DEFAULT_TEAM_ROLES.map((role) => ({ ...role, teamId })),
    skipDuplicates: true,
  });
}

/**
 * One team's catalog, in order. Falls back to the built-in defaults for a team
 * that somehow has none, so a missing catalog degrades to today's behaviour
 * rather than a set with no roles at all.
 */
export async function getTeamCatalog(
  teamId: string | null | undefined
): Promise<TeamRoleDef[]> {
  if (!teamId) return DEFAULT_TEAM_ROLES;
  const roles = await prisma.teamRole.findMany({
    where: { teamId },
    select: TEAM_ROLE_FIELDS,
    orderBy: { order: "asc" },
  });
  return roles.length > 0 ? orderedRoles(roles) : DEFAULT_TEAM_ROLES;
}

/**
 * Catalogs for many teams at once, keyed by team id — for the endpoints that
 * return a batch of sets spanning several teams (the calendar, the exports)
 * and would otherwise fire one query per set.
 */
export async function getTeamCatalogs(
  teamIds: (string | null | undefined)[]
): Promise<Map<string, TeamRoleDef[]>> {
  const ids = [...new Set(teamIds.filter((id): id is string => !!id))];
  const out = new Map<string, TeamRoleDef[]>();
  if (ids.length === 0) return out;

  const roles = await prisma.teamRole.findMany({
    where: { teamId: { in: ids } },
    select: { ...TEAM_ROLE_FIELDS, teamId: true },
    orderBy: { order: "asc" },
  });
  for (const { teamId, ...role } of roles) {
    out.set(teamId, [...(out.get(teamId) ?? []), role]);
  }
  return out;
}
