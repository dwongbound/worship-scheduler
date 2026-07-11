// Parsing of the ORG_KEYS env var — kept dependency-free (no prisma, no
// next-auth) so prisma/seed.ts and unit tests can import it directly.
// The server-side org machinery lives in lib/org.ts.

export type OrgKeyEntry = { name: string; key: string };

// Name of the placeholder org the multi_org migration parks pre-org data
// under; lib/org.ts ensureOrgsSynced() renames it to the first env org.
export const MIGRATION_PLACEHOLDER = "__default__";

/**
 * Parse an ORG_KEYS value: comma-separated "Name:key" entries, split on the
 * LAST colon so names may contain colons (keys may not). Whitespace around
 * names/keys is trimmed; malformed or duplicate (name or key) entries after
 * the first are dropped with a warning. Pure — unit-tested.
 */
export function parseOrgKeys(
  raw: string | undefined = process.env.ORG_KEYS
): OrgKeyEntry[] {
  const entries: OrgKeyEntry[] = [];
  for (const part of (raw ?? "").split(",")) {
    const idx = part.lastIndexOf(":");
    const name = idx < 0 ? "" : part.slice(0, idx).trim();
    const key = idx < 0 ? "" : part.slice(idx + 1).trim();
    if (!name || !key || name === MIGRATION_PLACEHOLDER) {
      if (part.trim()) console.warn(`[org] ignoring malformed ORG_KEYS entry: "${part}"`);
      continue;
    }
    if (entries.some((e) => e.name === name || e.key === key)) {
      console.warn(`[org] ignoring duplicate ORG_KEYS entry: "${name}"`);
      continue;
    }
    entries.push({ name, key });
  }
  return entries;
}
