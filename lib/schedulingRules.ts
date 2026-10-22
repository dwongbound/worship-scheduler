// Scheduling rules — the org's own instructions to the auto-fill, on top of
// rotation. Pure vocabulary + validation; the fill that obeys them is in
// lib/scheduler.ts, the prisma side is the SchedulingRule model, the editor is
// components/OrgRules.tsx.
//
// One list per org. Each rule applies to EVERY team unless it names one
// (`teamId`), and then only to that team's sets — a team-less set ("open to
// the whole org") only ever follows the all-teams rules. A rule that names a
// role applies wherever a team in its scope has a role with that key.
//
// Two tiers:
//   • REQUIRED — never broken. When one can't be met, the slot it governs is
//     left open (and reads as unfillable in the review), never filled against
//     it. Because they can't bend, two required rules that can't both hold are
//     refused on save: `findContradiction` is run by the PUT route AND by the
//     editor, so the editor explains what the server would refuse.
//   • PREFERENCE — followed when possible, and RANKED: the list order is the
//     priority. When two pull different ways on one pick, the higher one wins,
//     and every preference outranks plain rotation (see `preferenceScore`).
//
// Seven kinds (see RULE_KINDS):
//   ONLY_IF_NEEDED  this person (optionally: in this role) is a last resort.
//                   Preference only — "required last resort" would just mean
//                   "never", which is what marking them inactive already is.
//   PREFER          pick A over B in a role, when both could take it.
//   SAME_PLAYER     two sets share whoever plays a role: every week for two
//                   recurring set types (same Mon–Sun week), or two specific
//                   sets once.
//   TOGETHER        two people ALWAYS or NEVER serve on the same set.
//   LIMIT           at most N sets a WEEK (Mon–Sun) or calendar MONTH. A
//                   team's limit counts only that team's sets.
//   MD_ORDER        which roles a musical director leads from, best first.
//                   Required only: it's the definition the whole app checks an
//                   MD against (lib/md.ts). The team's own beats the all-teams
//                   one; with neither, the built-in MD_ROLES.
//   SHARE_ROLES     whoever plays one of `withRoles` may also play `role` on
//                   the same set — the only way one person holds two roles on
//                   a set in Auto schedule. REQUIRED also means `role` goes
//                   ONLY to someone doubling that way (never a player of its
//                   own); a PREFERENCE gives it to them first and falls back
//                   to anyone who plays it.
//
// Every org starts with today's built-in behaviour written out as rules
// (DEFAULT_RULES), so it can be read, scoped to a team, or turned off.
//
// Weeks and months are read on the app's clock (lib/appTz.ts), for the same
// reason availability is: "the same week" has to mean the church's week.

import { APP_TZ } from "./appTz";
import { zonedParts } from "./dates";
import { ACOUSTIC_GUITAR, ACOUSTIC_HOST_ROLES, MD_ROLES } from "./constants";
import { MD_KEY } from "./teamRoles";

// Never in an MD order: the worship leader can't also direct (lib/md.ts), and
// MD itself isn't a seat anyone plays from.
export const NOT_MD_ROLES = ["WORSHIP_LEADER", MD_KEY];

export type RuleTier = "REQUIRED" | "PREFERENCE";
export type RulePeriod = "WEEK" | "MONTH";

export type RuleParams =
  | { kind: "ONLY_IF_NEEDED"; userId: string; role: string | null }
  | { kind: "PREFER"; userId: string; otherUserId: string; role: string }
  | {
      kind: "SAME_PLAYER";
      role: string;
      scope: "WEEKLY";
      // Two SetTemplate ids.
      templateIds: [string, string];
    }
  | {
      kind: "SAME_PLAYER";
      role: string;
      scope: "ONCE";
      // Two Set ids.
      setIds: [string, string];
    }
  | { kind: "TOGETHER"; userIds: [string, string]; mode: "ALWAYS" | "NEVER" }
  | { kind: "LIMIT"; userId: string; max: number; period: RulePeriod }
  // Roles in preference order — the MD leads from the first one seated.
  | { kind: "MD_ORDER"; roles: string[] }
  | { kind: "SHARE_ROLES"; role: string; withRoles: string[] };

export type RuleKind = RuleParams["kind"];

export interface SchedulingRule {
  id: string;
  tier: RuleTier;
  enabled: boolean;
  // The one team this rule is for; null/absent = every team.
  teamId?: string | null;
  params: RuleParams;
}

export const RULE_KINDS: {
  kind: RuleKind;
  title: string;
  description: string;
  // ONLY_IF_NEEDED can't be required (see the header).
  tiers: RuleTier[];
}[] = [
  {
    kind: "ONLY_IF_NEEDED",
    title: "Only if needed",
    description: "Seat someone only when nobody else is free.",
    tiers: ["PREFERENCE"],
  },
  {
    kind: "PREFER",
    title: "Pick one person first",
    description: "When two people could play a role, pick one.",
    tiers: ["REQUIRED", "PREFERENCE"],
  },
  {
    kind: "SAME_PLAYER",
    title: "Same player",
    description: "Two sets share whoever plays a role.",
    tiers: ["REQUIRED", "PREFERENCE"],
  },
  {
    kind: "TOGETHER",
    title: "Together or apart",
    description: "Two people always or never serve together.",
    tiers: ["REQUIRED", "PREFERENCE"],
  },
  {
    kind: "LIMIT",
    title: "Limit",
    description: "Cap how often someone is scheduled.",
    tiers: ["REQUIRED", "PREFERENCE"],
  },
  {
    kind: "MD_ORDER",
    title: "MD order",
    description: "Which roles a musical director leads from, best first.",
    tiers: ["REQUIRED"],
  },
  {
    kind: "SHARE_ROLES",
    title: "Two roles, one person",
    description: "Let someone play a second role on the same set.",
    tiers: ["REQUIRED", "PREFERENCE"],
  },
];

export const MAX_RULES = 200;
export const LIMIT_MAX = 31;
// How many roles an MD order or a shared role may list.
export const ROLE_LIST_MAX = 8;

/**
 * What every org starts with: the behaviour that used to be built in, as
 * rules. The migration that introduced MD_ORDER and SHARE_ROLES wrote these
 * onto every existing org; new orgs get them on creation (see
 * lib/schedulingRuleStore.ts defaultRuleRows).
 */
export const DEFAULT_RULES: Omit<SchedulingRule, "id">[] = [
  { tier: "REQUIRED", enabled: true, teamId: null, params: { kind: "MD_ORDER", roles: [...MD_ROLES] } },
  {
    tier: "REQUIRED",
    enabled: true,
    teamId: null,
    params: { kind: "SHARE_ROLES", role: ACOUSTIC_GUITAR, withRoles: [...ACOUSTIC_HOST_ROLES] },
  },
];

/**
 * DEFAULT_RULES as rows for a brand-new org — pass as
 * `schedulingRules: { create: defaultRuleRows() }` wherever an org is created
 * (lib/org.ts, the platform orgs route, prisma/seed.ts), so every org starts
 * with the behaviour that used to be built in.
 */
export function defaultRuleRows() {
  return DEFAULT_RULES.map((r, position) => ({
    position,
    tier: r.tier,
    enabled: r.enabled,
    params: r.params as unknown as Record<string, string | string[]>,
  }));
}

// ── Parsing ───────────────────────────────────────────────────────────────

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 100;
const isPair = (v: unknown): v is [string, string] =>
  Array.isArray(v) && v.length === 2 && isId(v[0]) && isId(v[1]);
// A non-empty list of distinct role keys, at most ROLE_LIST_MAX long.
const roleList = (v: unknown): string[] | null =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.length <= ROLE_LIST_MAX &&
  v.every(isId) &&
  new Set(v).size === v.length
    ? [...(v as string[])]
    : null;

/**
 * One rule's params from untrusted JSON (a request body, or a stored row), or
 * an error saying what's wrong with it. Unknown keys are dropped.
 */
export function parseRuleParams(raw: unknown): RuleParams | string {
  if (!raw || typeof raw !== "object") return "A rule is missing its details.";
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "ONLY_IF_NEEDED":
      if (!isId(r.userId)) return "Pick a person.";
      if (r.role != null && !isId(r.role)) return "Pick a role.";
      return { kind: "ONLY_IF_NEEDED", userId: r.userId, role: (r.role as string) ?? null };
    case "PREFER":
      if (!isId(r.userId) || !isId(r.otherUserId)) return "Pick two people.";
      if (r.userId === r.otherUserId) return "Pick two different people.";
      if (!isId(r.role)) return "Pick a role.";
      return { kind: "PREFER", userId: r.userId, otherUserId: r.otherUserId, role: r.role };
    case "SAME_PLAYER":
      if (!isId(r.role)) return "Pick a role.";
      if (r.scope === "WEEKLY") {
        if (!isPair(r.templateIds)) return "Pick two set types.";
        if (r.templateIds[0] === r.templateIds[1]) return "Pick two different set types.";
        return { kind: "SAME_PLAYER", role: r.role, scope: "WEEKLY", templateIds: [r.templateIds[0], r.templateIds[1]] };
      }
      if (r.scope === "ONCE") {
        if (!isPair(r.setIds)) return "Pick two sets.";
        if (r.setIds[0] === r.setIds[1]) return "Pick two different sets.";
        return { kind: "SAME_PLAYER", role: r.role, scope: "ONCE", setIds: [r.setIds[0], r.setIds[1]] };
      }
      return "Pick every week or specific dates.";
    case "TOGETHER":
      if (!isPair(r.userIds)) return "Pick two people.";
      if (r.userIds[0] === r.userIds[1]) return "Pick two different people.";
      if (r.mode !== "ALWAYS" && r.mode !== "NEVER") return "Pick always or never.";
      return { kind: "TOGETHER", userIds: [r.userIds[0], r.userIds[1]], mode: r.mode };
    case "LIMIT": {
      if (!isId(r.userId)) return "Pick a person.";
      const max = Number(r.max);
      if (!Number.isInteger(max) || max < 1 || max > LIMIT_MAX) return `A limit must be 1–${LIMIT_MAX} sets.`;
      if (r.period !== "WEEK" && r.period !== "MONTH") return "Pick a week or a month.";
      return { kind: "LIMIT", userId: r.userId, max, period: r.period };
    }
    case "MD_ORDER": {
      const roles = roleList(r.roles);
      if (!roles) {
        return Array.isArray(r.roles) && r.roles.length > 0 && new Set(r.roles).size !== r.roles.length
          ? "Pick each role once."
          : `Pick 1–${ROLE_LIST_MAX} roles.`;
      }
      if (roles.includes("WORSHIP_LEADER")) return "The worship leader can't also be the MD.";
      if (roles.includes(MD_KEY)) return "Pick the instruments an MD plays from.";
      return { kind: "MD_ORDER", roles };
    }
    case "SHARE_ROLES": {
      if (!isId(r.role)) return "Pick the role they also play.";
      const withRoles = roleList(r.withRoles);
      if (!withRoles) {
        return Array.isArray(r.withRoles) && r.withRoles.length > 0 && new Set(r.withRoles).size !== r.withRoles.length
          ? "Pick each role once."
          : `Pick 1–${ROLE_LIST_MAX} roles they already play.`;
      }
      if (withRoles.includes(r.role)) return "A role can't be shared with itself.";
      if (r.role === MD_KEY || withRoles.includes(MD_KEY)) return "MD isn't a seat to share.";
      return { kind: "SHARE_ROLES", role: r.role, withRoles };
    }
    default:
      return "Unknown kind of rule.";
  }
}

/**
 * Stored rows → rules, in order. A row that no longer parses (hand-edited, or
 * from a future version) is skipped rather than breaking the whole list.
 */
export function parseStoredRules(
  rows: { id: string; tier: string; enabled: boolean; teamId?: string | null; params: unknown }[]
): SchedulingRule[] {
  const out: SchedulingRule[] = [];
  for (const row of rows) {
    const params = parseRuleParams(row.params);
    if (typeof params === "string") continue;
    const tier: RuleTier = row.tier === "REQUIRED" ? "REQUIRED" : "PREFERENCE";
    out.push({
      id: row.id,
      tier: forcedTier(params.kind) ?? tier,
      enabled: row.enabled,
      teamId: row.teamId ?? null,
      params,
    });
  }
  return out;
}

/** Does `rule` govern a set on `teamId`? A team-less set follows only all-teams rules. */
export function ruleAppliesTo(rule: Pick<SchedulingRule, "teamId">, teamId: string | null | undefined): boolean {
  return !rule.teamId || rule.teamId === (teamId ?? null);
}

/**
 * The roles an MD leads from on a set of `teamId`, best first: the team's own
 * enabled MD order, else the all-teams one, else the built-in MD_ROLES. The
 * one answer lib/md.ts, the auto-fill and every MD check share.
 */
export function mdRolesFor(
  rules: SchedulingRule[] | null | undefined,
  teamId: string | null | undefined
): string[] {
  const orders = (rules ?? []).filter((r) => r.enabled && r.params.kind === "MD_ORDER");
  const own = teamId ? orders.find((r) => r.teamId === teamId) : undefined;
  const all = orders.find((r) => !r.teamId);
  const pick = own ?? all;
  return pick && pick.params.kind === "MD_ORDER" ? pick.params.roles : MD_ROLES;
}

/** The only tier a kind may take, when it may take only one. */
function forcedTier(kind: RuleKind): RuleTier | null {
  const tiers = RULE_KINDS.find((k) => k.kind === kind)?.tiers ?? [];
  return tiers.length === 1 ? tiers[0] : null;
}

// What a rule may point at — the ids that exist in this org.
export interface RuleRefs {
  userIds: Set<string>;
  roleKeys: Set<string>;
  templateIds: Set<string>;
  setIds: Set<string>;
  // Each team's role keys — a rule scoped to a team may only name its roles.
  // Absent (older callers): team scope isn't checked beyond `roleKeys`.
  teamRoleKeys?: Map<string, Set<string>>;
}

/** The ids a rule points at, by what they are. */
export function ruleRefs(p: RuleParams): {
  users: string[];
  roles: string[];
  templates: string[];
  sets: string[];
} {
  switch (p.kind) {
    case "ONLY_IF_NEEDED":
      return { users: [p.userId], roles: p.role ? [p.role] : [], templates: [], sets: [] };
    case "PREFER":
      return { users: [p.userId, p.otherUserId], roles: [p.role], templates: [], sets: [] };
    case "SAME_PLAYER":
      return p.scope === "WEEKLY"
        ? { users: [], roles: [p.role], templates: [...p.templateIds], sets: [] }
        : { users: [], roles: [p.role], templates: [], sets: [...p.setIds] };
    case "TOGETHER":
      return { users: [...p.userIds], roles: [], templates: [], sets: [] };
    case "LIMIT":
      return { users: [p.userId], roles: [], templates: [], sets: [] };
    case "MD_ORDER":
      return { users: [], roles: [...p.roles], templates: [], sets: [] };
    case "SHARE_ROLES":
      return { users: [], roles: [p.role, ...p.withRoles], templates: [], sets: [] };
  }
}

/** Why `teamId` can't scope a rule naming `roles` in this org, or null if it can. */
export function teamScopeProblem(
  teamId: string | null | undefined,
  roles: string[],
  refs: RuleRefs
): string | null {
  if (!teamId || !refs.teamRoleKeys) return null;
  const own = refs.teamRoleKeys.get(teamId);
  if (!own) return "That team doesn't exist any more.";
  if (roles.some((k) => !own.has(k))) return "That team doesn't have that role.";
  return null;
}

/**
 * A whole list from a request body: every rule parsed, every reference checked
 * against this org, and the required ones checked against each other. Either
 * the cleaned list (in the order given — the preference ranking) or the first
 * problem, with the index of the rule it's about.
 */
export function validateRules(
  raw: unknown,
  refs: RuleRefs
):
  | { ok: true; rules: Omit<SchedulingRule, "id">[] }
  | { ok: false; error: string; index: number | null } {
  if (!Array.isArray(raw)) return { ok: false, error: "Expected a list of rules.", index: null };
  if (raw.length > MAX_RULES) {
    return { ok: false, error: `At most ${MAX_RULES} rules per org.`, index: null };
  }
  const rules: (Omit<SchedulingRule, "id"> & { id: string })[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i] as Record<string, unknown> | null;
    const params = parseRuleParams(item?.params);
    if (typeof params === "string") return { ok: false, error: params, index: i };
    const r = ruleRefs(params);
    if (r.users.some((id) => !refs.userIds.has(id))) {
      return { ok: false, error: "That person isn't in this org any more.", index: i };
    }
    if (r.roles.some((k) => !refs.roleKeys.has(k))) {
      return { ok: false, error: "No team has that role any more.", index: i };
    }
    if (r.templates.some((id) => !refs.templateIds.has(id))) {
      return { ok: false, error: "That recurring set doesn't exist any more.", index: i };
    }
    if (r.sets.some((id) => !refs.setIds.has(id))) {
      return { ok: false, error: "That set doesn't exist any more.", index: i };
    }
    const rawTeam = item?.teamId;
    if (rawTeam != null && !isId(rawTeam)) return { ok: false, error: "Pick a team.", index: i };
    const teamId = (rawTeam as string | null | undefined) ?? null;
    const scope = teamScopeProblem(teamId, r.roles, refs);
    if (scope) return { ok: false, error: scope, index: i };
    const asked: RuleTier = item?.tier === "REQUIRED" ? "REQUIRED" : "PREFERENCE";
    rules.push({
      id: String(i),
      tier: forcedTier(params.kind) ?? asked,
      enabled: item?.enabled !== false,
      teamId,
      params,
    });
  }
  const clash = findContradiction(rules);
  if (clash) return { ok: false, error: clash.message, index: clash.index };
  return { ok: true, rules: rules.map(({ id: _id, ...rest }) => rest) };
}

// ── Contradictions between required rules ────────────────────────────────

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * The first required rule that can't hold alongside the required rules before
 * it, or null. Only ENABLED required rules count — a switched-off rule
 * constrains nothing, and preferences are allowed to disagree (that's what
 * their ranking is for). Checks:
 *   • the same rule twice;
 *   • TOGETHER: two people who must always serve together but, through any
 *     chain of "always" rules, must also never;
 *   • PREFER: a cycle in one role (A over B, B over C, C over A);
 *   • LIMIT: two different caps on one person for the same period (and scope);
 *   • MD_ORDER: two orders for the same scope.
 * Rules scoped to different teams never meet (see the scope note inside).
 * SAME_PLAYER isn't checked: it can always hold on its own terms, because when
 * the shared player can't make the second set the slot is simply left open.
 * `index` is the position (in the list given) of the rule that tipped it over;
 * `otherIndex` the earlier rule it clashes with, when there is one.
 */
export function findContradiction(
  rules: SchedulingRule[]
): { index: number; otherIndex: number | null; message: string } | null {
  // Team scope: two rules only meet on sets they both govern, so the check runs
  // once over the all-teams rules and once per team over that team's rules
  // plus the all-teams ones. The earliest rule to tip any of them over wins.
  const live = rules
    .map((rule, i) => ({ rule, i }))
    .filter(({ rule }) => rule.enabled && rule.tier === "REQUIRED");
  const teams = [...new Set(live.flatMap(({ rule }) => (rule.teamId ? [rule.teamId] : [])))];
  let first: ReturnType<typeof contradictionAmong> = null;
  for (const team of [null, ...teams]) {
    const clash = contradictionAmong(
      live.filter(({ rule }) => !rule.teamId || rule.teamId === team)
    );
    if (clash && (!first || clash.index < first.index)) first = clash;
  }
  return first;
}

type Clash = { index: number; otherIndex: number | null; message: string };

// findContradiction over one scope's enabled required rules, each with its
// index in the full list.
function contradictionAmong(list: { rule: SchedulingRule; i: number }[]): Clash | null {
  const seen = new Map<string, number>();
  // MD_ORDER: one per exact scope (a team's own order overrides the
  // all-teams one rather than clashing with it).
  const mdOrders = new Map<string, number>();
  // TOGETHER: union-find over ALWAYS links; NEVER pairs are checked against it.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    while (p !== (parent.get(p) ?? p)) p = parent.get(p) ?? p;
    return p;
  };
  const always: { a: string; b: string; i: number }[] = [];
  const never: { a: string; b: string; i: number }[] = [];
  // PREFER: role → edges a→b (a beats b).
  const prefer = new Map<string, { a: string; b: string; i: number }[]>();
  // LIMIT: user|period → { max, index }.
  const limits = new Map<string, { max: number; i: number }>();

  for (const { rule, i } of list) {
    const p = rule.params;
    const scope = rule.teamId ?? "";
    const key = `${scope}|${canonicalKey(p)}`;
    const dup = seen.get(key);
    if (dup !== undefined) {
      return { index: i, otherIndex: dup, message: "This required rule is already on the list." };
    }
    seen.set(key, i);

    if (p.kind === "TOGETHER") {
      const [a, b] = p.userIds;
      if (p.mode === "ALWAYS") {
        always.push({ a, b, i });
        parent.set(find(a), find(b));
      } else {
        never.push({ a, b, i });
      }
      // Re-check every NEVER pair after each change: a new ALWAYS link can
      // join two groups that an earlier NEVER rule keeps apart.
      for (const n of never) {
        if (find(n.a) === find(n.b)) {
          const other = n.i === i ? lastAlwaysLinking(always, n.a, n.b) : n.i;
          return {
            index: i,
            otherIndex: other,
            message:
              "This contradicts another required rule: the same two people would have to serve together and never serve together.",
          };
        }
      }
    }

    if (p.kind === "PREFER") {
      const edges = prefer.get(p.role) ?? [];
      edges.push({ a: p.userId, b: p.otherUserId, i });
      prefer.set(p.role, edges);
      const loop = cycleThrough(edges, p.userId, p.otherUserId);
      if (loop !== null) {
        return {
          index: i,
          otherIndex: loop,
          message:
            "This contradicts another required rule: each person would have to be picked over the other.",
        };
      }
    }

    if (p.kind === "MD_ORDER") {
      const prev = mdOrders.get(scope);
      if (prev !== undefined) {
        return {
          index: i,
          otherIndex: prev,
          message: scope
            ? "This team already has an MD order."
            : "There's already an MD order for every team.",
        };
      }
      mdOrders.set(scope, i);
    }

    // A team's own limit counts only that team's sets, so it never clashes
    // with an all-teams cap on the same person.
    if (p.kind === "LIMIT") {
      const k = `${p.userId}|${p.period}|${scope}`;
      const prev = limits.get(k);
      if (prev && prev.max !== p.max) {
        return {
          index: i,
          otherIndex: prev.i,
          message: "This person already has a different required limit for that period.",
        };
      }
      limits.set(k, { max: p.max, i });
    }
  }
  return null;
}

// The most recent ALWAYS rule touching either person — what to point at when a
// NEVER rule is the one that tipped it over.
function lastAlwaysLinking(
  always: { a: string; b: string; i: number }[],
  a: string,
  b: string
): number | null {
  for (let k = always.length - 1; k >= 0; k--) {
    const e = always[k];
    if (e.a === a || e.b === a || e.a === b || e.b === b) return e.i;
  }
  return always.length ? always[always.length - 1].i : null;
}

// Does the new edge from→to close a cycle (is `from` reachable from `to`)?
// Returns the index of an edge on that path, or null.
function cycleThrough(
  edges: { a: string; b: string; i: number }[],
  from: string,
  to: string
): number | null {
  const stack: { node: string; via: number | null }[] = [{ node: to, via: null }];
  const visited = new Set<string>();
  while (stack.length) {
    const { node, via } = stack.pop()!;
    if (node === from) return via;
    if (visited.has(node)) continue;
    visited.add(node);
    for (const e of edges) {
      if (e.a === node) stack.push({ node: e.b, via: via ?? e.i });
    }
  }
  return null;
}

/** A key two identical rules share, whatever order their pairs were picked in. */
export function canonicalKey(p: RuleParams): string {
  switch (p.kind) {
    case "ONLY_IF_NEEDED":
      return `O|${p.userId}|${p.role ?? ""}`;
    case "PREFER":
      return `P|${p.role}|${p.userId}|${p.otherUserId}`;
    case "SAME_PLAYER":
      return p.scope === "WEEKLY"
        ? `S|W|${p.role}|${pairKey(...p.templateIds)}`
        : `S|O|${p.role}|${pairKey(...p.setIds)}`;
    case "TOGETHER":
      // The mode and the cap are part of the key: ALWAYS vs NEVER, or two
      // different caps, are contradictions with their own (clearer) messages.
      return `T|${p.mode}|${pairKey(...p.userIds)}`;
    case "LIMIT":
      return `L|${p.userId}|${p.period}|${p.max}`;
    case "MD_ORDER":
      return `M|${p.roles.join(",")}`;
    case "SHARE_ROLES":
      return `R|${p.role}|${[...p.withRoles].sort().join(",")}`;
  }
}

// ── Words ─────────────────────────────────────────────────────────────────

/** A run of a rule's sentence: the names are `strong`, the glue is plain. */
export interface RulePart {
  text: string;
  strong: boolean;
}

export interface RuleNames {
  user: (id: string) => string;
  role: (key: string) => string;
  template: (id: string) => string;
  set: (id: string) => string;
  team?: (id: string) => string;
}

// "A", "A or B", "A, B or C" as parts, each name strong.
function roleListParts(keys: string[], names: RuleNames, joiner: string): RulePart[] {
  const out: RulePart[] = [];
  keys.forEach((k, i) => {
    if (i > 0) out.push({ text: i === keys.length - 1 ? ` ${joiner} ` : ", ", strong: false });
    out.push({ text: names.role(k), strong: true });
  });
  return out;
}

const roleListText = (keys: string[], names: RuleNames, joiner: string) =>
  roleListParts(keys, names, joiner).map((x) => x.text).join("");

/** The rule as the sentence the editor shows: "Pick Priya over Hannah on Keys". */
export function describeRule(p: RuleParams, names: RuleNames): RulePart[] {
  const S = (text: string): RulePart => ({ text, strong: true });
  const T = (text: string): RulePart => ({ text, strong: false });
  switch (p.kind) {
    case "ONLY_IF_NEEDED":
      return p.role
        ? [S(names.user(p.userId)), T(" is seated on "), S(names.role(p.role)), T(" only if nobody else is free")]
        : [S(names.user(p.userId)), T(" is seated only if nobody else is free")];
    case "PREFER":
      return [T("Pick "), S(names.user(p.userId)), T(" over "), S(names.user(p.otherUserId)), T(" on "), S(names.role(p.role))];
    case "SAME_PLAYER":
      return p.scope === "WEEKLY"
        ? [S(names.template(p.templateIds[0])), T(" and "), S(names.template(p.templateIds[1])), T(" in the same week share their "), S(names.role(p.role)), T(" player")]
        : [S(names.set(p.setIds[0])), T(" and "), S(names.set(p.setIds[1])), T(" share their "), S(names.role(p.role)), T(" player")];
    case "TOGETHER":
      return [S(names.user(p.userIds[0])), T(" and "), S(names.user(p.userIds[1])), T(p.mode === "ALWAYS" ? " always serve on the same set" : " never serve on the same set")];
    case "LIMIT":
      return [S(names.user(p.userId)), T(" plays at most "), S(String(p.max)), T(` set${p.max === 1 ? "" : "s"} a ${p.period === "WEEK" ? "week" : "month"}`)];
    case "MD_ORDER":
      return [T("Musical directors lead from "), ...roleListParts(p.roles, names, "then")];
    case "SHARE_ROLES":
      return [T("Whoever plays "), ...roleListParts(p.withRoles, names, "or"), T(" may also play "), S(names.role(p.role))];
  }
}

export const ruleSentence = (p: RuleParams, names: RuleNames) =>
  describeRule(p, names).map((x) => x.text).join("");

/** The editor's "What this does" line. */
export function explainRule(p: RuleParams, tier: RuleTier, names: RuleNames): string {
  const req = tier === "REQUIRED";
  switch (p.kind) {
    case "ONLY_IF_NEEDED": {
      const a = names.user(p.userId);
      return `${a} is a last resort${p.role ? ` on ${names.role(p.role)}` : ""}. Auto schedule picks anyone else who is free first, even someone who served last week, and seats ${a} only to avoid an empty slot.`;
    }
    case "PREFER": {
      const a = names.user(p.userId);
      const b = names.user(p.otherUserId);
      const role = names.role(p.role);
      return req
        ? `Whenever both are free, ${a} gets ${role}, even if ${b} has played less. ${b} plays it only when ${a} can't.`
        : `${a} gets ${role} over ${b} when both are free, unless a higher preference says otherwise.`;
    }
    case "SAME_PLAYER": {
      const role = names.role(p.role);
      const pair =
        p.scope === "WEEKLY"
          ? `each week's ${names.template(p.templateIds[0])} and ${names.template(p.templateIds[1])} (weeks run Monday to Sunday)`
          : `${names.set(p.setIds[0])} and ${names.set(p.setIds[1])}`;
      return `Whoever is picked for ${role} on ${pair} plays both. ${
        req
          ? "If that person can't make the second one, its slot stays open for you to fill."
          : "If nobody can make both, each set gets its own player."
      }`;
    }
    case "TOGETHER": {
      const a = names.user(p.userIds[0]);
      const b = names.user(p.userIds[1]);
      if (p.mode === "ALWAYS") {
        return `When one of them is seated, the other is seated too, in any open role they play. ${
          req ? "If the other can't be seated, neither is." : "If the other can't be seated, the first can still serve."
        }`;
      }
      return `${a} and ${b} won't both be put on one set. ${req ? "Never broken, even if a slot stays empty." : "Broken only to avoid an empty slot."}`;
    }
    case "LIMIT": {
      const a = names.user(p.userId);
      const span = p.period === "WEEK" ? "week (Monday to Sunday)" : "calendar month";
      return `Auto schedule won't seat ${a} more than ${p.max} time${p.max === 1 ? "" : "s"} in a ${span}. ${
        req ? "Picking them by hand still works." : "It can go over to avoid an empty slot."
      }`;
    }
    case "MD_ORDER": {
      const first = names.role(p.roles[0]);
      return `A musical director only leads from ${roleListText(p.roles, names, "or")}, never from any other role or as the worship leader. When a set needs an MD, ${first} is tried first${
        p.roles.length > 1 ? ", then the rest in this order" : ""
      }.`;
    }
    case "SHARE_ROLES": {
      const role = names.role(p.role);
      const hosts = roleListText(p.withRoles, names, "or");
      return req
        ? `${role} only goes to someone already seated as ${hosts} on that set who also plays it. If none of them do, it stays open rather than going to a separate player.`
        : `${role} goes first to someone already seated as ${hosts} who also plays it. If none of them do, anyone who plays ${role} can take it.`;
    }
  }
}

// ── Calendar buckets ──────────────────────────────────────────────────────

/** The Monday (as a ymd number) of the Mon–Sun week `at` falls in, on the app's clock. */
export function weekKey(at: Date | number, timeZone: string = APP_TZ): number {
  const p = zonedParts(new Date(at), timeZone);
  const back = (p.weekday + 6) % 7; // days since Monday
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return monday.getUTCFullYear() * 10000 + (monday.getUTCMonth() + 1) * 100 + monday.getUTCDate();
}

/** yyyymm of the calendar month `at` falls in, on the app's clock. */
export function monthKey(at: Date | number, timeZone: string = APP_TZ): number {
  const p = zonedParts(new Date(at), timeZone);
  return p.year * 100 + p.month;
}

export function periodKey(at: Date | number, period: RulePeriod, timeZone: string = APP_TZ): number {
  return period === "WEEK" ? weekKey(at, timeZone) : monthKey(at, timeZone);
}

// ── Which recurring set a set came from ───────────────────────────────────

export interface TemplateShape {
  id: string;
  label: string;
  teamId: string | null;
  dayOfWeek: number;
  startMinute: number;
}

/**
 * The recurring set (SetTemplate) a set is an occurrence of: same name, same
 * team, on its weekday and time — or null. Sets don't store the link (the
 * generator expands templates into ordinary rows), so a weekly SAME_PLAYER rule
 * recognises its sets the way the calendar's Preview Mode does (see
 * lib/calendarPreview.ts setTypeOf).
 */
export function templateIdOf(
  set: { label: string | null; teamId: string | null; startsAt: Date },
  templates: TemplateShape[],
  timeZone: string = APP_TZ
): string | null {
  const at = zonedParts(set.startsAt, timeZone);
  const hit = templates.find(
    (t) =>
      t.label === (set.label ?? null) &&
      (t.teamId ?? null) === (set.teamId ?? null) &&
      t.dayOfWeek === at.weekday &&
      t.startMinute === at.minuteOfDay
  );
  return hit?.id ?? null;
}
