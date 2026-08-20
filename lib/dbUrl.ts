// DATABASE_URL normalization for the pg driver (used by @prisma/adapter-pg).
//
// pg 8.16+ warns on every startup that sslmode=prefer|require|verify-ca are
// currently treated as aliases for verify-full, and that pg v9 /
// pg-connection-string v3 will switch them to standard libpq semantics — where
// `require` encrypts but does NOT verify the server certificate.
//
// We want to keep what we have today (full verification against Neon's public
// cert), so we state it explicitly rather than relying on an alias that's about
// to change meaning. That silences the warning AND pins the behavior across the
// upgrade. The alternative the warning offers — uselibpqcompat=true — would opt
// into the weaker mode, so we don't take it.
//
// Pure string work: no db connection, no env reads.

// The modes pg currently aliases to verify-full, and will stop aliasing.
const ALIASED_MODES = new Set(["prefer", "require", "verify-ca"]);

/**
 * Return `url` with any about-to-change sslmode spelled out as verify-full.
 * Left untouched: URLs with no sslmode (plain local Postgres over a docker
 * network), ones already at verify-full/disable/no-verify, and ones that opted
 * into libpq semantics with uselibpqcompat — that's a deliberate choice to
 * respect, not a warning to paper over.
 */
export function normalizeDatabaseUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // not a URL we can reason about — hand it to pg unchanged
  }

  if (parsed.searchParams.get("uselibpqcompat") === "true") return url;

  const sslmode = parsed.searchParams.get("sslmode");
  if (!sslmode || !ALIASED_MODES.has(sslmode)) return url;

  parsed.searchParams.set("sslmode", "verify-full");
  return parsed.toString();
}
