// The prisma side of scheduling rules (lib/schedulingRules.ts is the pure
// vocabulary). Server-only.
import { prisma } from "./prisma";
import { APP_TZ } from "./appTz";
import type { FixedSet, ExistingAssignment } from "./scheduler";
import {
  parseStoredRules,
  ruleRefs,
  rulesVersion,
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
  const [users, roles, templates, sets, teams] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { orgId } } },
      select: { id: true },
    }),
    prisma.teamRole.findMany({
      where: { team: { orgId } },
      select: { key: true },
    }),
    prisma.setTemplate.findMany({ where: { orgId }, select: { id: true } }),
    prisma.set.findMany({ where: { orgId }, select: { id: true } }),
    prisma.team.findMany({ where: { orgId }, select: { id: true } }),
  ]);
  return {
    teamIds: new Set(teams.map((t) => t.id)),
    userIds: new Set(users.map((u) => u.id)),
    roleKeys: new Set(roles.map((r) => r.key)),
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
    r.sets.every((id) => refs.setIds.has(id))
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
      select: { id: true, tier: true, enabled: true, params: true, teamId: true },
    }),
    refs ? Promise.resolve(refs) : orgRuleRefs(orgId),
  ]);
  return parseStoredRules(rows).filter((r) => ruleIsLive(r, live));
}

/**
 * The fingerprint of the org's list as stored (see `rulesVersion`).
 *
 * Read from the STORED rows, not from `loadOrgRules`, which drops rules
 * pointing at something deleted: a change to one of those is still a change to
 * the list, and an editor that didn't see it is still working from a stale copy.
 */
export async function orgRulesVersion(orgId: string): Promise<string> {
  const rows = await prisma.schedulingRule.findMany({
    where: { orgId },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  return rulesVersion(rows.map((r) => r.id));
}

/** Thrown by `saveOrgRules` when the list moved under the save. */
export class StaleRulesError extends Error {
  constructor() {
    super("these rules changed since you opened them");
    this.name = "StaleRulesError";
  }
}

/**
 * Replace the org's whole list, in order (already validated).
 *
 * `expectedVersion` is the fingerprint the saver loaded. Checked INSIDE the
 * transaction, against the rows about to be deleted, so two admins saving at
 * the same moment can't both pass: the second one's version no longer matches
 * and it is refused rather than reverting the first one's work. Omitting it
 * saves unconditionally, which is what a caller with no earlier read wants.
 */
export async function saveOrgRules(
  orgId: string,
  rules: Omit<SchedulingRule, "id">[],
  expectedVersion?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (expectedVersion !== undefined) {
      const rows = await tx.schedulingRule.findMany({
        where: { orgId },
        orderBy: { position: "asc" },
        select: { id: true },
      });
      if (rulesVersion(rows.map((r) => r.id)) !== expectedVersion) {
        throw new StaleRulesError();
      }
    }
    await tx.schedulingRule.deleteMany({ where: { orgId } });
    await tx.schedulingRule.createMany({
      data: rules.map((r, position) => ({
        orgId,
        position,
        tier: r.tier,
        enabled: r.enabled,
        params: r.params,
        teamId: r.teamId ?? null,
      })),
    });
  });
}

/** The names and choices the rules editor draws its dropdowns from. */
export async function ruleEditorOptions(orgId: string) {
  const now = Date.now();
  const [people, roles, templates, sets, teams, memberships] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { orgId } } },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.teamRole.findMany({
      where: { team: { orgId } },
      select: { key: true, label: true, order: true },
      orderBy: { order: "asc" },
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
    // Each team WITH its roles, and every membership's roles: the editor
    // narrows as you go — team first, then that team's roles, then the people
    // who actually play the picked role there.
    prisma.team.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        roles: { select: { key: true, label: true }, orderBy: { order: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.teamMember.findMany({
      where: { team: { orgId } },
      select: { userId: true, teamId: true, roles: true },
    }),
  ]);
  // One entry per role KEY across every team — a rule's role applies wherever
  // a team has it. The first team's label (catalog order) names it.
  const roleByKey = new Map<string, { key: string; label: string }>();
  for (const r of roles) if (!roleByKey.has(r.key)) roleByKey.set(r.key, { key: r.key, label: r.label });
  return {
    teams,
    // Each person's team memberships, so the people list can be narrowed to
    // whoever plays the chosen role on the chosen team.
    people: people.map((p) => ({
      ...p,
      teams: memberships
        .filter((m) => m.userId === p.id)
        .map((m) => ({ teamId: m.teamId, roles: m.roles })),
    })),
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
      // teamId so a TEAM-SCOPED limit counts only its own team's sets.
      select: {
        userId: true,
        setId: true,
        set: { select: { startsAt: true, teamId: true } },
      },
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
      setId: b.setId,
    })),
  };
}
