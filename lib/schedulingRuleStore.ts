// The prisma side of scheduling rules (lib/schedulingRules.ts is the pure
// vocabulary). Server-only.
import { prisma } from "./prisma";
import { APP_TZ } from "./appTz";
import type { FixedSet, ExistingAssignment } from "./scheduler";
import {
  mdRolesFor,
  parseStoredRules,
  ruleRefs,
  teamScopeProblem,
  templateIdOf,
  type RuleRefs,
  type SchedulingRule,
} from "./schedulingRules";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// What the one-off SAME_PLAYER picker offers: sets from a week back to this
// far ahead. (A rule keeps working on a set outside it; this only bounds the
// list.)
const PICKABLE_SET_DAYS = 180;

/** Everything a rule in this org may point at. */
export async function orgRuleRefs(orgId: string): Promise<RuleRefs> {
  const [users, roles, templates, sets] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { orgId } } },
      select: { id: true },
    }),
    prisma.team.findMany({
      where: { orgId },
      select: { id: true, roles: { select: { key: true } } },
    }),
    prisma.setTemplate.findMany({ where: { orgId }, select: { id: true } }),
    prisma.set.findMany({ where: { orgId }, select: { id: true } }),
  ]);
  return {
    userIds: new Set(users.map((u) => u.id)),
    roleKeys: new Set(roles.flatMap((t) => t.roles.map((r) => r.key))),
    teamRoleKeys: new Map(roles.map((t) => [t.id, new Set(t.roles.map((r) => r.key))])),
    templateIds: new Set(templates.map((t) => t.id)),
    setIds: new Set(sets.map((s) => s.id)),
  };
}

/** Does every id this rule names still exist? */
export function ruleIsLive(rule: SchedulingRule, refs: RuleRefs): boolean {
  const r = ruleRefs(rule.params);
  return (
    r.users.every((id) => refs.userIds.has(id)) &&
    r.roles.every((k) => refs.roleKeys.has(k)) &&
    r.templates.every((id) => refs.templateIds.has(id)) &&
    r.sets.every((id) => refs.setIds.has(id)) &&
    teamScopeProblem(rule.teamId, r.roles, refs) === null
  );
}

/**
 * The org's rules in list order, minus any left pointing at something that's
 * since been deleted (a person who left, a removed role). Dropping them here
 * means the editor never shows them and the next save removes them for good.
 */
export async function loadOrgRules(orgId: string, refs?: RuleRefs): Promise<SchedulingRule[]> {
  const [rows, live] = await Promise.all([
    prisma.schedulingRule.findMany({
      where: { orgId },
      orderBy: { position: "asc" },
      select: { id: true, tier: true, enabled: true, teamId: true, params: true },
    }),
    refs ? Promise.resolve(refs) : orgRuleRefs(orgId),
  ]);
  return parseStoredRules(rows).filter((r) => ruleIsLive(r, live));
}

/** Replace the org's whole list, in order (already validated). */
export async function saveOrgRules(
  orgId: string,
  rules: Omit<SchedulingRule, "id">[]
): Promise<void> {
  await prisma.$transaction([
    prisma.schedulingRule.deleteMany({ where: { orgId } }),
    prisma.schedulingRule.createMany({
      data: rules.map((r, position) => ({
        orgId,
        position,
        tier: r.tier,
        enabled: r.enabled,
        teamId: r.teamId ?? null,
        params: r.params,
      })),
    }),
  ]);
}

/**
 * The roles an MD may lead from on a set of `teamId` in this org (see
 * mdRolesFor). A cheap read — just the org's rule rows — for the server's MD
 * checks, which run on every roster save.
 */
export async function orgMdRoles(orgId: string, teamId: string | null): Promise<string[]> {
  const rows = await prisma.schedulingRule.findMany({
    where: { orgId, OR: [{ teamId: null }, ...(teamId ? [{ teamId }] : [])] },
    orderBy: { position: "asc" },
    select: { id: true, tier: true, enabled: true, teamId: true, params: true },
  });
  return mdRolesFor(parseStoredRules(rows), teamId);
}

/** The names and choices the rules editor draws its dropdowns from. */
export async function ruleEditorOptions(orgId: string) {
  const now = Date.now();
  const [people, roles, teams, templates, sets] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { orgId } } },
      select: { id: true, name: true, teamMembers: { where: { team: { orgId } }, select: { teamId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.teamRole.findMany({
      where: { team: { orgId } },
      select: { key: true, label: true, order: true, teamId: true },
      orderBy: { order: "asc" },
    }),
    prisma.team.findMany({
      where: { orgId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.setTemplate.findMany({
      where: { orgId },
      select: {
        id: true,
        label: true,
        dayOfWeek: true,
        startMinute: true,
        team: { select: { name: true } },
      },
      orderBy: [{ dayOfWeek: "asc" }, { startMinute: "asc" }],
    }),
    prisma.set.findMany({
      where: {
        orgId,
        startsAt: {
          gte: new Date(now - 7 * MS_PER_DAY),
          lte: new Date(now + PICKABLE_SET_DAYS * MS_PER_DAY),
        },
      },
      select: { id: true, label: true, startsAt: true, team: { select: { name: true } } },
      orderBy: { startsAt: "asc" },
    }),
  ]);
  // One entry per role KEY across every team — a rule's role applies wherever
  // a team has it. The first team's label (catalog order) names it.
  // `teamIds` says which teams have it, so a team-scoped rule only offers
  // that team's roles (and `people[].teamIds` its members).
  const roleByKey = new Map<string, { key: string; label: string; teamIds: string[] }>();
  for (const r of roles) {
    const entry = roleByKey.get(r.key) ?? { key: r.key, label: r.label, teamIds: [] };
    entry.teamIds.push(r.teamId);
    roleByKey.set(r.key, entry);
  }
  return {
    people: people.map((p) => ({
      id: p.id,
      name: p.name,
      teamIds: p.teamMembers.map((m) => m.teamId),
    })),
    teams,
    roles: [...roleByKey.values()],
    templates: templates.map((t) => ({
      id: t.id,
      label: t.label,
      dayOfWeek: t.dayOfWeek,
      startMinute: t.startMinute,
      teamName: t.team?.name ?? null,
    })),
    sets: sets.map((s) => ({
      id: s.id,
      label: s.label,
      startsAt: s.startsAt.toISOString(),
      teamName: s.team?.name ?? null,
    })),
  };
}

/**
 * Real sets around [from, to] as SAME_PLAYER partners (with each one's
 * recurring set recognised), plus any set a one-off rule names wherever it
 * falls; and the bookings in the months either side, for LIMIT counting.
 */
export async function ruleContext(
  orgId: string,
  rules: SchedulingRule[],
  from: Date,
  to: Date
): Promise<{ fixedSets: FixedSet[]; periodBookings: ExistingAssignment[] }> {
  const namedSetIds = rules.flatMap((r) =>
    r.params.kind === "SAME_PLAYER" && r.params.scope === "ONCE" ? r.params.setIds : []
  );
  const near = {
    gte: new Date(from.getTime() - 7 * MS_PER_DAY),
    lte: new Date(to.getTime() + 7 * MS_PER_DAY),
  };
  const [templates, sets, bookings] = await Promise.all([
    prisma.setTemplate.findMany({
      where: { orgId },
      select: { id: true, label: true, teamId: true, dayOfWeek: true, startMinute: true },
    }),
    prisma.set.findMany({
      where: {
        orgId,
        OR: [{ startsAt: near }, ...(namedSetIds.length ? [{ id: { in: namedSetIds } }] : [])],
      },
      select: {
        id: true,
        label: true,
        teamId: true,
        startsAt: true,
        assignments: { where: { guestTeamId: null }, select: { userId: true, role: true } },
      },
    }),
    // Cross-org on purpose, like the load counts: a cap on how often someone
    // serves means how often they serve, wherever.
    prisma.assignment.findMany({
      where: {
        set: {
          startsAt: {
            gte: new Date(from.getTime() - 31 * MS_PER_DAY),
            lte: new Date(to.getTime() + 31 * MS_PER_DAY),
          },
        },
      },
      select: { userId: true, set: { select: { startsAt: true, teamId: true } } },
    }),
  ]);
  return {
    fixedSets: sets.map((s) => ({
      setId: s.id,
      templateId: templateIdOf(s, templates, APP_TZ),
      startsAt: s.startsAt,
      assignments: s.assignments,
    })),
    periodBookings: bookings.map((b) => ({
      userId: b.userId,
      startsAt: b.set.startsAt,
      teamId: b.set.teamId,
    })),
  };
}
