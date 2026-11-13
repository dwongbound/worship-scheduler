// Who a verified Google or Apple identity signs in as (iOS app). The prisma
// side of lib/socialToken.ts, mirroring the web's Google sign-in (lib/auth.ts
// signIn) so the two doors agree:
//
//   1. Apple: the account already linked to this Apple id (`appleSub`).
//   2. Either: the account with this VERIFIED email. A placeholder imported
//      for that address is claimed, exactly as on the web. Apple links its id
//      here, so a later Hide-My-Email change still finds them.
//   3. Nobody: a new account — unless someone already serves under the same
//      name, which is far more likely the same person on a second address.
//      That answers `conflicts` once; `allowDuplicateName` is the "not me".
//
// No email and no link (Apple with the email scope refused) can't be matched
// or given a username, so it is refused with words saying so.
import { claimPlaceholder, findUserByEmail } from "./accountClaim";
import type { NameConflict } from "./nameConflict";
import { findNameConflicts } from "./nameConflictStore";
import { prisma } from "./prisma";
import type { SocialIdentity } from "./socialToken";

type UserRow = NonNullable<Awaited<ReturnType<typeof findUserByEmail>>>;

export type SocialSignInResult =
  | { kind: "user"; user: UserRow; created: boolean }
  | { kind: "conflicts"; conflicts: NameConflict[] }
  | { kind: "refused"; error: string };

export async function resolveSocialUser(
  identity: SocialIdentity,
  opts: { name?: string | null; allowDuplicateName?: boolean } = {}
): Promise<SocialSignInResult> {
  if (identity.provider === "apple") {
    const linked = await prisma.user.findUnique({ where: { appleSub: identity.subject } });
    if (linked) return { kind: "user", user: linked, created: false };
  }

  const email = identity.email;
  if (!email) {
    return {
      kind: "refused",
      error:
        "We need your email to find your account. Sign in again and share your email, or sign in with your password.",
    };
  }

  // The name the provider (or, for Apple, the app — Apple shows it only once)
  // gave us, falling back to the address itself, as the web does.
  const offeredName = (identity.name ?? opts.name ?? "").trim() || null;

  const existing = await findUserByEmail(email);
  if (existing) {
    let user = existing;
    if (existing.isPlaceholder) {
      user = await claimPlaceholder(existing.id, {
        name: existing.name || offeredName || undefined,
      });
    }
    if (identity.provider === "apple" && !user.appleSub) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { appleSub: identity.subject },
      });
    }
    return { kind: "user", user, created: false };
  }

  if (!opts.allowDuplicateName) {
    const conflicts = await findNameConflicts(offeredName ?? "", email);
    if (conflicts.length > 0) return { kind: "conflicts", conflicts };
  }

  const user = await prisma.user.create({
    data: {
      email,
      name: offeredName ?? email,
      username: email,
      passwordHash: "", // signs in through the provider — no usable password
      instruments: [],
      ...(identity.provider === "apple" ? { appleSub: identity.subject } : {}),
    },
  });
  return { kind: "user", user, created: true };
}
