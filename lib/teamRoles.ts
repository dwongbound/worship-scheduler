// The role vocabulary. Roles used to be a fixed `Instrument` enum; they're now
// per-team DATA (the TeamRole table), so this module is what turns a team's
// catalog into the things the rest of the app asks for: what roles exist, in
// what order, how many of each a set wants, and what to call them.
//
// A role is identified by its `key` — stable, unique within its team, and what
// Assignment.role / TeamMember.roles store. Labels are free to change; keys
// never do, so renaming "Vox" to "Backing Vocals" can't orphan a single slot.
//
// Pure data + pure functions: safe to import from client components, API
// routes, and unit tests alike.
import {
  CHOIR,
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  SLOT_CAPACITIES,
  MAX_SLOTS_PER_ROLE,
} from "./constants";

/** One role in a team's catalog — the client-side shape of a TeamRole row. */
export interface TeamRoleDef {
  key: string;
  label: string;
  defaultCount: number;
  adminOnly: boolean;
  order: number;
}

/**
 * Musical director. Like choir, MD keeps its long-standing special behaviour
 * pinned to this one built-in key — a custom role never becomes MD-capable.
 * What's new is that it's a catalog row: a team that deletes MD has the whole
 * feature switched off (no "Require MD" on its sets, no picker, no warning, no
 * reservation in the auto-fill). See teamSupportsMD.
 */
export const MD_KEY = "MD";

/**
 * A set has at most one MD, so MD's catalog count is capped here rather than at
 * MAX_SLOTS_PER_ROLE. Keeping it to one is what spares the rest of the app any
 * "which of the two MDs?" handling.
 */
export const MAX_MDS_PER_SET = 1;

/** Does this team have MD at all? Everything MD-related hangs off this. */
export function teamSupportsMD(catalog: TeamRoleDef[]): boolean {
  return catalog.some((r) => r.key === MD_KEY);
}

/**
 * The catalog a brand-new team starts with: exactly the roles this app shipped
 * with, in the order and counts they've always had. An admin edits from here —
 * these are defaults, not rules.
 *
 * Kept in step with the SQL in migrations/20260821140000_per_team_roles, which
 * seeded the same list onto every team that existed before catalogs did.
 */
export const DEFAULT_TEAM_ROLES: TeamRoleDef[] = [
  ...ROLE_ORDER.map((key, i) => ({
    key,
    label: INSTRUMENT_LABELS[key],
    defaultCount: SLOT_CAPACITIES[key],
    adminOnly: false,
    order: i,
  })),
  // Musical director. A designation rather than a slot — the MD also plays an
  // instrument (see MD_KEY) — so it seats nobody of its own, but it lives in
  // the catalog so a team can simply not have one. Admin-only from the start:
  // an admin has always been the one to say who may MD.
  {
    key: MD_KEY,
    label: "MD",
    defaultCount: MAX_MDS_PER_SET,
    adminOnly: true,
    order: ROLE_ORDER.length,
  },
  // Choir has never had a slot count — it's an unbounded, admin-managed list
  // (see CHOIR_KEY below), so it sits at the end with a count of 0.
  {
    key: CHOIR,
    label: INSTRUMENT_LABELS[CHOIR],
    defaultCount: 0,
    adminOnly: false,
    order: ROLE_ORDER.length + 1,
  },
];

/**
 * Choir stays special: it's an unbounded list on a set rather than a fixed
 * number of slots, and the set-detail modal manages it in its own section. That
 * behaviour is pinned to this one built-in key on purpose — a custom role never
 * inherits it (nor MD eligibility; see MD_ROLES).
 */
export const CHOIR_KEY: string = CHOIR;

/**
 * Roles that carry a slot count, in fill order. Choir and MD are both left out:
 * choir is an unbounded list, and MD is a designation on top of someone who is
 * already playing — neither is a row on the roster.
 */
export function bandRoles(catalog: TeamRoleDef[]): TeamRoleDef[] {
  return orderedRoles(catalog).filter(
    (r) => r.key !== CHOIR_KEY && r.key !== MD_KEY
  );
}

/** The catalog in display + fill order (scarce-first), ties broken on key. */
export function orderedRoles(catalog: TeamRoleDef[]): TeamRoleDef[] {
  return [...catalog].sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}

/**
 * What to call a role key. Prefers the team's own label; falls back to the
 * built-in name, then to a humanized key ("SOUND_BOOTH" → "Sound Booth").
 *
 * The fallback chain is what lets a role read correctly in places that don't
 * have the catalog to hand — an old history line, or a slot whose role the team
 * has since deleted.
 */
export function roleLabel(key: string, catalog?: TeamRoleDef[]): string {
  const own = catalog?.find((r) => r.key === key);
  if (own) return own.label;
  if (key in INSTRUMENT_LABELS) return INSTRUMENT_LABELS[key];
  return humanize(key);
}

/** "SOUND_BOOTH" → "Sound Booth". */
function humanize(key: string): string {
  return key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * A role's machine key, derived from the name an admin typed. Uppercase,
 * underscores, letters and digits only — so "Sound Booth" and "sound booth"
 * land on the same key and can't become two roles that read identically.
 *
 * Derived ONCE, at creation. A later rename changes the label and leaves the
 * key alone (see the TeamRole model).
 */
export function roleKeyFromLabel(label: string): string {
  return label
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/**
 * A set's team shape: how many of each role it wants. The team's catalog gives
 * the baseline (`defaultCount` per role) and the set's own stored override —
 * partial, keyed by role key — wins where it has an opinion.
 *
 * This is THE way to read a set's shape. Never read defaultCount directly once
 * a set may carry an override, and never assume the built-in role list.
 */
export function resolveTeamCapacities(
  catalog: TeamRoleDef[],
  stored?: Record<string, number> | null
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const role of bandRoles(catalog)) {
    const override = stored?.[role.key];
    out[role.key] = typeof override === "number" ? override : role.defaultCount;
  }
  return out;
}

/**
 * Validate a catalog arriving from the role editor. Returns the cleaned list
 * (ordered, keys derived where missing) or an error message naming what's
 * wrong — the editor shows it verbatim, so the wording is user-facing.
 */
export function validateCatalog(
  raw: unknown
): { roles: TeamRoleDef[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "A team needs at least one role." };
  }

  const roles: TeamRoleDef[] = [];
  const seen = new Set<string>();

  for (const [i, entry] of raw.entries()) {
    if (!entry || typeof entry !== "object") {
      return { error: "Malformed role." };
    }
    const e = entry as Record<string, unknown>;

    const label = typeof e.label === "string" ? e.label.trim() : "";
    if (!label) return { error: "Every role needs a name." };
    if (label.length > 40) {
      return { error: `"${label.slice(0, 20)}…" is too long — 40 characters max.` };
    }

    // An existing role sends its key back so a rename keeps its slots; a new
    // one gets its key derived from the name.
    const key =
      typeof e.key === "string" && e.key.trim()
        ? e.key.trim()
        : roleKeyFromLabel(label);
    if (!key) {
      return { error: `"${label}" needs at least one letter or number.` };
    }
    if (seen.has(key)) {
      return { error: `Two roles would share the key "${key}" — rename one.` };
    }
    seen.add(key);

    // MD is capped at one per set; everything else at the usual slot ceiling.
    const max = key === MD_KEY ? MAX_MDS_PER_SET : MAX_SLOTS_PER_ROLE;
    const count = Number(e.defaultCount);
    if (!Number.isInteger(count) || count < 0 || count > max) {
      return { error: `"${label}" needs a count between 0 and ${max}.` };
    }

    roles.push({
      key,
      label,
      defaultCount: count,
      adminOnly: e.adminOnly === true,
      // Position in the submitted list IS the order — the editor lets an admin
      // reorder, and scarce-first ordering is theirs to decide now.
      order: i,
    });
  }

  return { roles };
}
