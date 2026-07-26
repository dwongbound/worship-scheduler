// Pure profile-editing rules (unit-tested in tests/unit/profile.test.ts).

/**
 * The email to persist when a user saves their profile.
 *
 * Google (OAuth-only) accounts sign in with their Google email, so it is NOT
 * user-editable: any email in the request is ignored and the stored value is
 * kept. Password accounts may change it freely; an empty value clears it.
 *
 * `hasPassword` is how we tell the two apart — OAuth-only accounts are created
 * with no password hash (mirrored on the client as the disabled email field).
 */
export function resolveProfileEmail(
  hasPassword: boolean,
  currentEmail: string | null,
  requestedEmail: string | null | undefined
): string | null {
  if (!hasPassword) return currentEmail;
  return requestedEmail || null;
}
