// How a person signs in, as the admin Team page shows it. Pure, so the rule
// is tested on its own; app/api/admin/users is its one caller.
//
//   - "apple":  linked to an Apple id (User.appleSub).
//   - "google": seen signing in with Google (User.googleSignInAt), or has no
//               password at all, which only Google sign-up creates.
//   - null:     a username + password account.
export type SignInMethod = "apple" | "google" | null;

export function signInMethod(u: {
  appleSub: string | null;
  googleSignInAt: Date | null;
  passwordHash: string;
}): SignInMethod {
  if (u.appleSub) return "apple";
  if (u.googleSignInAt || !u.passwordHash) return "google";
  return null;
}
