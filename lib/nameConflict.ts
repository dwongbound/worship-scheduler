// Duplicate-name detection at account creation.
//
// The failure this prevents: someone already has an account (or an imported
// roster row) under "Jane Kim" with one address, then signs up — or signs in
// with Google — using a DIFFERENT address. Nothing stops that, and the org ends
// up with two "Jane Kim"s: one carrying all the history, one holding the
// sessions. Email is the only identity we key on (see lib/accountClaim), so a
// mismatched address is invisible to the claim path.
//
// We can't decide for them — two people really can share a name — so this is a
// WARNING, not a block: the signup route (and the Google signIn callback) stop
// once, name the account we found, and let the person either use that address
// or say "that isn't me" and carry on.
//
// This module is the pure vocabulary — the login page (a client component)
// imports the encode/decode helpers, so nothing here may touch prisma. The
// lookup itself lives in lib/nameConflictStore, same split as
// teamRoles/teamRoleStore.

export interface NameConflict {
  /** The existing account's name, as stored (its capitalisation, not theirs). */
  name: string;
  /** What they'd sign in with instead. Conflicts without an email are dropped. */
  email: string;
  /**
   * True when this is an imported roster row nobody has claimed yet, which
   * changes the advice: you SIGN UP with that address (claiming the row),
   * rather than signing in to an account that already has a password.
   */
  isPlaceholder: boolean;
}

/** Trim + collapse inner whitespace, so "Jane  Kim " matches "Jane Kim". */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/**
 * Short-lived consent cookie for the Google path — see
 * app/api/auth/allow-duplicate-name. Its value is the email it was granted for.
 */
export const DUPLICATE_NAME_COOKIE = "ws-allow-duplicate-name";

/**
 * Where the NextAuth signIn callback sends someone whose Google name collides
 * with an existing account. The login page reads these params and opens the
 * same warning popup the credentials signup gets.
 */
export function nameConflictRedirect(
  email: string,
  conflicts: NameConflict[]
): string {
  const params = new URLSearchParams({
    nameConflict: email,
    // One row per conflict, encoded as "email|0|Name" (0/1 = placeholder). The
    // name travels along so the popup reads the same for both providers without
    // an extra, unauthenticated lookup endpoint.
    conflicts: conflicts
      .map((c) => `${c.email}|${c.isPlaceholder ? 1 : 0}|${c.name}`)
      .join("\n"),
  });
  return `/login?${params.toString()}`;
}

/** Inverse of the encoding above, for the login page. */
export function parseNameConflicts(raw: string | null): NameConflict[] {
  if (!raw) return [];
  return raw
    .split("\n")
    .map((line) => {
      const [email, placeholder, ...rest] = line.split("|");
      const name = rest.join("|");
      if (!email || !name) return null;
      return { email, name, isPlaceholder: placeholder === "1" };
    })
    .filter((c): c is NameConflict => c !== null);
}
