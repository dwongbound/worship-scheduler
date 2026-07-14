// NextAuth configuration: username + password (credentials), plus optional
// Google OAuth. Slack is NOT a login provider — it's a per-org integration
// connected after login (see lib/slack + the /api/slack/* routes).
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

// Google sign-in is optional: it's only enabled when its OAuth credentials
// are configured, so the app still runs (credentials-only) without them.
const googleEnabled =
  !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;

export const authOptions: NextAuthOptions = {
  // Credentials logins require JWT sessions (no db session rows).
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Username / Email & Password",
      credentials: {
        username: { label: "Username / Email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials.password) return null;

        const user = await prisma.user.findFirst({
          where: {
            OR: [
              { username: credentials.username },
              { email: credentials.username },
            ],
          },
        });
        if (!user) return null;

        const passwordOk = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        );
        if (!passwordOk) return null;

        // Whatever we return here lands in the `user` arg of the jwt
        // callback below on first sign-in.
        return {
          id: user.id,
          name: user.name,
          email: user.email ?? undefined,
        };
      },
    }),
    // Optional Google OAuth. Only registered when configured.
    ...(googleEnabled
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : []),
    // NOTE: "Sign in with Slack" was removed as a LOGIN provider — Slack
    // identity is workspace-scoped, which clashes with our multi-org (multi-
    // workspace) model. Slack is now a per-org INTEGRATION connected after
    // login (see the Slack connect/install flow), not a way to sign in.
  ],
  callbacks: {
    // Google OAuth sign-ins have no row in our User table yet: find-or-create
    // one by email so they map onto our own accounts. Credentials logins are
    // already validated in authorize(), so they pass through.
    async signIn({ user, account }) {
      // Only OAuth sign-ins (Google) need a find-or-create by email; credentials
      // are already validated in authorize() and pass straight through.
      if (account?.provider !== "google") return true;
      const email = user.email;
      if (!email) return false;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        await prisma.user.create({
          data: {
            email,
            name: user.name ?? email,
            username: email,
            passwordHash: "", // OAuth account — no usable password
            instruments: [],
          },
        });
      }
      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      // First sign-in: copy our custom fields onto the token. For Google the
      // `user` is the OAuth profile, so resolve our real user row by email.
      if (user) {
        const isOAuth = account?.provider === "google";
        if (isOAuth && user.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.name = dbUser.name;
          }
        } else {
          token.id = user.id;
        }
      }
      // Profile page calls useSession().update({ name }) after edits so
      // the navbar shows the new name without re-login.
      if (trigger === "update" && session?.name) {
        token.name = session.name;
      }
      // Org memberships ride on the token as UI hints (tab visibility, org
      // dropdown) — the server re-checks the db on every admin request. Load
      // them on sign-in and on ANY useSession().update() call, which is how
      // the /join page refreshes tabs right after redeeming a key.
      if (token.id && (user || trigger === "update")) {
        const rows = await prisma.orgMembership.findMany({
          where: { userId: token.id },
          select: { orgId: true, isAdmin: true },
        });
        token.memberships = rows;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.memberships = token.memberships ?? [];
        // Re-evaluated from the env allowlist on every session read, so adding
        // a super-admin takes effect without the user re-logging in.
        session.user.isSuperAdmin = isSuperAdmin(token.email as string | undefined);
      }
      return session;
    },
  },
};

/** Convenience: current session user (or null) for API routes. */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  // The JWT stays cryptographically valid even after its user row is gone
  // (e.g. the account was deleted, or a dev reseed rebuilt the table with new
  // ids). Re-check the id against the db so a "ghost" session is treated as
  // logged-out — every API route then 401s and the client guard boots it to
  // /login instead of silently rendering an empty app.
  const exists = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true },
  });
  if (!exists) return null;
  return session.user;
}

// Admin checks are per-org now — see requireOrgAdmin / requireOrgAdminFor in
// lib/org.ts (the old global getAdminUser() was removed with User.isAdmin).

// Platform super-admins (create orgs, rotate keys, manage the app itself) are a
// small env allowlist — a bootstrap capability that changes ~never, so it stays
// in env rather than the db. Comma-separated emails, case-insensitive.
function superAdminEmails(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  return !!email && superAdminEmails().includes(email.toLowerCase());
}

/** Guard for /platform routes + APIs. Returns the user, or null if not a super-admin. */
export async function requireSuperAdmin() {
  const user = await getSessionUser();
  if (!isSuperAdmin(user?.email)) return null;
  return user;
}
