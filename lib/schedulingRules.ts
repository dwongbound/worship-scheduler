// Scheduling rules — the org's own instructions to the auto-fill, on top of
// rotation. Pure vocabulary + validation; the fill that obeys them is in
// lib/scheduler.ts, the prisma side is the SchedulingRule model, the editor is
// components/OrgRules.tsx.
//
// Rules are ORG-WIDE: one list per org, applied to every set on every team. A
// rule that names a role applies wherever a team has a role with that key.
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
// Five kinds (see RULE_KINDS):
//   ONLY_IF_NEEDED  this person (optionally: in this role) is a last resort.
//                   Preference only — "required last resort" would just mean
//                   "never", which is what marking them inactive already is.
//   PREFER          pick A over B in a role, when both could take it.
//   SAME_PLAYER     two sets share whoever plays a role: every week for two
//                   recurring set types (same Mon–Sun week), or two specific
//                   sets once. Required, the pick is made from people free for
//                   BOTH sets; if nobody is, both slots stay open.
//   TOGETHER        two people ALWAYS or NEVER serve on the same set.
//   LIMIT           at most N sets a WEEK (Mon–Sun) or calendar MONTH.
//
// Weeks and months are read on the app's clock (lib/appTz.ts), for the same
// reason availability is: "the same week" has to mean the church's week.

import { APP_TZ } from "./appTz";
import { zonedParts } from "./dates";

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
  // `userId` null caps EVERYONE in the org — the same ceiling applied to each
  // person separately, not a total across the team.
  | { kind: "LIMIT"; userId: string | null; max: number; period: RulePeriod }
  // ── Role-shaped rules ──────────────────────────────────────────────────
  // The three below describe ROLES, not people, and they are how the built-in
  // behaviours that predate rules became visible and editable. Each one has a
  // built-in default (lib/constants.ts) that applies when an org has no rule
  // governing that thing — so an org that has never been seeded behaves
  // EXACTLY as it did before rules existed. See resolveRoleBehavior.
  //
  // Which roles a musical director may lead from, best first. One per org.
  | { kind: "LEADS_FROM"; roles: string[] }
  // `role` is only ever played by someone already holding one of `hostRoles`
  // on that set (acoustic guitar ← worship leader / vocals). One per role.
  | { kind: "ROLE_HOST"; role: string; hostRoles: string[] }
  // These two roles may be held by the SAME person on one set. Everything
  // else is one role per person.
  | { kind: "MAY_DOUBLE"; roles: [string, string] };

export type RuleKind = RuleParams["kind"];

export interface SchedulingRule {
  id: string;
  tier: RuleTier;
  enabled: boolean;
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
  // REQUIRED only: these describe what a role IS, not who to prefer, so
  // "follow it when convenient" has no meaning.
  {
    kind: "LEADS_FROM",
    title: "Who can lead",
    description: "Which roles a musical director leads from.",
    tiers: ["REQUIRED"],
  },
  {
    kind: "ROLE_HOST",
    title: "Doubles up with",
    description: "A role only played by someone already in another role.",
    tiers: ["REQUIRED"],
  },
  {
    kind: "MAY_DOUBLE",
    title: "Can play both",
    description: "Two roles one person may hold on the same set.",
    tiers: ["REQUIRED"],
  },
];

export const MAX_RULES = 200;
export const LIMIT_MAX = 31;

// ── Parsing ───────────────────────────────────────────────────────────────

const isId = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0 && v.length <= 100;
const isRoleList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 20 && v.every(isId);
const isPair = (v: unknown): v is [string, string] =>
  Array.isArray(v) && v.length === 2 && isId(v[0]) && isId(v[1]);

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
      if (r.userId != null && !isId(r.userId)) return "Pick a person.";
      const max = Number(r.max);
      if (!Number.isInteger(max) || max < 1 || max > LIMIT_MAX) return `A limit must be 1–${LIMIT_MAX} sets.`;
      if (r.period !== "WEEK" && r.period !== "MONTH") return "Pick a week or a month.";
      return { kind: "LIMIT", userId: (r.userId as string) ?? null, max, period: r.period };
    }
    case "LEADS_FROM": {
      if (!isRoleList(r.roles) || r.roles.length === 0) return "Pick at least one role.";
      if (new Set(r.roles).size !== r.roles.length) return "Each role can only be listed once.";
      return { kind: "LEADS_FROM", roles: [...r.roles] };
    }
    case "ROLE_HOST": {
      if (!isId(r.role)) return "Pick a role.";
      if (!isRoleList(r.hostRoles) || r.hostRoles.length === 0) return "Pick at least one role to double up with.";
      if (r.hostRoles.includes(r.role)) return "A role can't double up with itself.";
      if (new Set(r.hostRoles).size !== r.hostRoles.length) return "Each role can only be listed once.";
      return { kind: "ROLE_HOST", role: r.role, hostRoles: [...r.hostRoles] };
    }
    case "MAY_DOUBLE":
      if (!isPair(r.roles)) return "Pick two roles.";
      if (r.roles[0] === r.roles[1]) return "Pick two different roles.";
      return { kind: "MAY_DOUBLE", roles: [r.roles[0], r.roles[1]] };
    default:
      return "Unknown kind of rule.";
  }
}

/**
 * Stored rows → rules, in order. A row that no longer parses (hand-edited, or
 * from a future version) is skipped rather than breaking the whole list.
 */
export function parseStoredRules(
  rows: { id: string; tier: string; enabled: boolean; params: unknown }[]
): SchedulingRule[] {
  const out: SchedulingRule[] = [];
  for (const row of rows) {
    const params = parseRuleParams(row.params);
    if (typeof params === "string") continue;
    const tier: RuleTier = row.tier === "REQUIRED" ? "REQUIRED" : "PREFERENCE";
    out.push({ id: row.id, tier: forcedTier(params.kind) ?? tier, enabled: row.enabled, params });
  }
  return out;
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
      // An everyone-limit names nobody, so it can't go stale.
      return { users: p.userId ? [p.userId] : [], roles: [], templates: [], sets: [] };
    case "LEADS_FROM":
      return { users: [], roles: [...p.roles], templates: [], sets: [] };
    case "ROLE_HOST":
      return { users: [], roles: [p.role, ...p.hostRoles], templates: [], sets: [] };
    case "MAY_DOUBLE":
      return { users: [], roles: [...p.roles], templates: [], sets: [] };
  }
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
    const asked: RuleTier = item?.tier === "REQUIRED" ? "REQUIRED" : "PREFERENCE";
    rules.push({
      id: String(i),
      tier: forcedTier(params.kind) ?? asked,
      enabled: item?.enabled !== false,
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
 *   • LIMIT: two different caps on one person for the same period.
 * SAME_PLAYER isn't checked: it can always hold on its own terms, because when
 * nobody is free for both sets their slots are simply left open.
 * `index` is the position (in the list given) of the rule that tipped it over;
 * `otherIndex` the earlier rule it clashes with, when there is one.
 */
export function findContradiction(
  rules: SchedulingRule[]
): { index: number; otherIndex: number | null; message: string } | null {
  const seen = new Map<string, number>();
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
  // LIMIT: user|period → { max, index }; "*" is the everyone-limit.
  const limits = new Map<string, { max: number; i: number }>();

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i];
    if (!rule.enabled || rule.tier !== "REQUIRED") continue;
    const p = rule.params;
    const key = canonicalKey(p);
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

    if (p.kind === "LIMIT") {
      const k = `${p.userId}|${p.period}`;
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
      return `L|${p.userId ?? "*"}|${p.period}|${p.max}`;
    // The payload is deliberately NOT in these keys: two "who can lead" rules
    // are a contradiction whatever they say, and so are two rules governing
    // the same role. One each is the whole point.
    case "LEADS_FROM":
      return "LF";
    case "ROLE_HOST":
      return `RH|${p.role}`;
    case "MAY_DOUBLE":
      return `MD|${pairKey(...p.roles)}`;
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
}

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
      return [S(p.userId ? names.user(p.userId) : "Everyone"), T(" plays at most "), S(String(p.max)), T(` set${p.max === 1 ? "" : "s"} a ${p.period === "WEEK" ? "week" : "month"}`)];
    case "LEADS_FROM":
      return [T("A musical director leads from "), S(roleList(p.roles, names)), T(", in that order")];
    case "ROLE_HOST":
      return [S(names.role(p.role)), T(" is only played by someone already on "), S(roleList(p.hostRoles, names))];
    case "MAY_DOUBLE":
      return [S(names.role(p.roles[0])), T(" and "), S(names.role(p.roles[1])), T(" can be played by the same person")];
  }
}

/** "Electric guitar, Keys or Bass" — a role list as one readable run. */
function roleList(roles: string[], names: RuleNames): string {
  const named = roles.map((r) => names.role(r));
  if (named.length <= 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} or ${named[named.length - 1]}`;
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
          ? "Only someone free for both is picked, so nobody is scheduled for one and then missing from the other. If nobody is free for both, both slots stay open for you to fill."
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
      const a = p.userId ? names.user(p.userId) : "anyone";
      const span = p.period === "WEEK" ? "week (Monday to Sunday)" : "calendar month";
      return `Auto schedule won't seat ${a} more than ${p.max} time${p.max === 1 ? "" : "s"} in a ${span}. ${
        req ? "Picking them by hand still works." : "It can go over to avoid an empty slot."
      }`;
    }
    case "LEADS_FROM":
      return `Only these roles count as leading, and a set that needs a musical director gets one seated in the first of them they play. Someone who directs but plays nothing on this list won't be the set's MD.`;
    case "ROLE_HOST": {
      const role = names.role(p.role);
      return `${role} goes to someone already on ${roleList(p.hostRoles, names)} who also plays it — never to a ${role}-only player. If none of them play it, the slot is left open.`;
    }
    case "MAY_DOUBLE":
      return `One person can hold both ${names.role(p.roles[0])} and ${names.role(p.roles[1])} on the same set. Every other pair of roles is one person each.`;
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

// ── Role behaviour: the built-ins, as rules ───────────────────────────────
//
// LEADS_FROM / ROLE_HOST / MAY_DOUBLE describe what used to be hardcoded in
// lib/constants.ts. `resolveRoleBehavior` is the ONE place that answers "so
// what applies here?", and its contract is what keeps this safe to ship:
//
//   • No rule governing a thing → the BUILT-IN default applies. An org that
//     has never been seeded (and every existing one) behaves exactly as it did
//     before rules existed.
//   • A rule governing it → that rule is the answer. Switched off means the
//     behaviour is OFF, not "fall back to the built-in" — otherwise an admin
//     could never turn one of these off at all.
//
// "Governing a thing" is per-scope: LEADS_FROM is org-wide, ROLE_HOST is per
// governed role, MAY_DOUBLE is per unordered pair. So adding a ROLE_HOST for a
// custom role leaves acoustic guitar's built-in default alone.

export interface RoleBehavior {
  /** Roles an MD may lead from, best first. */
  mdRoles: string[];
  /** Roles `role` must already be held alongside, or null if unrestricted. */
  hostRolesFor: (role: string) => string[] | null;
  /** Whether one person may hold both roles on a set. */
  mayDouble: (a: string, b: string) => boolean;
}

export function resolveRoleBehavior(
  rules: SchedulingRule[] | undefined,
  builtIn: {
    mdRoles: string[];
    hostRoles: Record<string, string[]>;
    doublePairs: [string, string][];
  }
): RoleBehavior {
  const all = rules ?? [];
  const on = all.filter((r) => r.enabled);

  const leads = all.find((r) => r.params.kind === "LEADS_FROM");
  const leadsOn = on.find((r) => r.params.kind === "LEADS_FROM");
  const mdRoles = leads
    ? leadsOn
      ? (leadsOn.params as Extract<RuleParams, { kind: "LEADS_FROM" }>).roles
      : [] // present but switched off: nothing counts as leading
    : builtIn.mdRoles;

  const hostAll = new Set(
    all.flatMap((r) => (r.params.kind === "ROLE_HOST" ? [r.params.role] : []))
  );
  const hostOn = new Map(
    on.flatMap((r) =>
      r.params.kind === "ROLE_HOST" ? ([[r.params.role, r.params.hostRoles]] as const) : []
    )
  );

  const doubleAll = new Set(
    all.flatMap((r) =>
      r.params.kind === "MAY_DOUBLE" ? [rolePairKey(r.params.roles)] : []
    )
  );
  const doubleOn = new Set(
    on.flatMap((r) =>
      r.params.kind === "MAY_DOUBLE" ? [rolePairKey(r.params.roles)] : []
    )
  );
  const builtInDoubles = new Set(builtIn.doublePairs.map(rolePairKey));

  return {
    mdRoles,
    hostRolesFor: (role) =>
      hostAll.has(role)
        ? hostOn.get(role) ?? null // present but off → unrestricted
        : builtIn.hostRoles[role] ?? null,
    mayDouble: (a, b) => {
      const key = rolePairKey([a, b]);
      return doubleAll.has(key) ? doubleOn.has(key) : builtInDoubles.has(key);
    },
  };
}

const rolePairKey = ([a, b]: readonly [string, string]) => pairKey(a, b);

/**
 * The rules a new org starts with: the built-in behaviour, written out. Seeded
 * on org create and backfilled onto existing orgs, purely so an admin can SEE
 * and change it — resolveRoleBehavior already falls back to the same values,
 * so an org without these rows schedules identically.
 */
export function defaultRoleRules(builtIn: {
  mdRoles: string[];
  hostRoles: Record<string, string[]>;
  doublePairs: [string, string][];
}): Omit<SchedulingRule, "id">[] {
  return [
    { tier: "REQUIRED", enabled: true, params: { kind: "LEADS_FROM", roles: [...builtIn.mdRoles] } },
    ...Object.entries(builtIn.hostRoles).map(([role, hostRoles]) => ({
      tier: "REQUIRED" as RuleTier,
      enabled: true,
      params: { kind: "ROLE_HOST" as const, role, hostRoles: [...hostRoles] },
    })),
    ...builtIn.doublePairs.map(([a, b]) => ({
      tier: "REQUIRED" as RuleTier,
      enabled: true,
      params: { kind: "MAY_DOUBLE" as const, roles: [a, b] as [string, string] },
    })),
  ];
}
