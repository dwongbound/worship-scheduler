// NextAuth configuration: username + password (credentials provider).
//
// Slack note: user records already carry `email` and `slackUserId` fields.
// When you add Slack later, you can either add a Slack OAuth provider here
// and link accounts by email, or use slackUserId to push DMs — no schema
// changes needed.
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

// "Sign in with Slack" is likewise optional. Same env-gating pattern as Google.
const slackEnabled =
  !!process.env.SLACK_CLIENT_ID && !!process.env.SLACK_CLIENT_SECRET;

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
          isAdmin: user.isAdmin,
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
    // Optional "Sign in with Slack" (OpenID Connect). We define it by hand
    // rather than using next-auth's built-in Slack provider so the `profile`
    // callback can pull the Slack member id — Slack returns it under the
    // "https://slack.com/user_id" key of the OIDC userinfo — which we persist
    // as `slackUserId` so the bot can DM this person later.
    ...(slackEnabled
      ? [
          {
            id: "slack",
            name: "Slack",
            type: "oauth" as const,
            wellKnown:
              "https://slack.com/.well-known/openid-configuration",
            authorization: { params: { scope: "openid email profile" } },
            idToken: true,
            clientId: process.env.SLACK_CLIENT_ID!,
            clientSecret: process.env.SLACK_CLIENT_SECRET!,
            profile(profile: Record<string, any>) {
              const slackUserId = profile["https://slack.com/user_id"] as string;
              return {
                id: slackUserId,
                name: profile.name as string,
                email: profile.email as string | undefined,
                slackUserId,
              };
            },
          },
        ]
      : []),
  ],
  callbacks: {
    // OAuth sign-ins (Google, Slack) have no row in our User table yet:
    // find-or-create one by email so they map onto our own accounts.
    // Credentials logins are already validated in authorize(), so they pass
    // through. For Slack we additionally persist the member id (`slackUserId`)
    // so the bot can DM this person — backfilling it on accounts that first
    // signed up with a password or Google.
    async signIn({ user, account }) {
      const provider = account?.provider;
      if (provider !== "google" && provider !== "slack") return true;
      const email = user.email;
      if (!email) return false;

      const slackUserId =
        provider === "slack"
          ? (user as { slackUserId?: string }).slackUserId
          : undefined;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        await prisma.user.create({
          data: {
            email,
            name: user.name ?? email,
            username: email,
            passwordHash: "", // OAuth account — no usable password
            instruments: [],
            slackUserId: slackUserId ?? null,
          },
        });
      } else if (slackUserId && existing.slackUserId !== slackUserId) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { slackUserId },
        });
      }
      return true;
    },
    async jwt({ token, user, account, trigger, session }) {
      // First sign-in: copy our custom fields onto the token. For Google the
      // `user` is the OAuth profile, so resolve our real user row by email.
      if (user) {
        const isOAuth =
          account?.provider === "google" || account?.provider === "slack";
        if (isOAuth && user.email) {
          const dbUser = await prisma.user.findUnique({
            where: { email: user.email },
          });
          if (dbUser) {
            token.id = dbUser.id;
            token.isAdmin = dbUser.isAdmin;
            token.name = dbUser.name;
          }
        } else {
          token.id = user.id;
          token.isAdmin = (user as { isAdmin?: boolean }).isAdmin ?? false;
        }
      }
      // Profile page calls useSession().update({ name }) after edits so
      // the navbar shows the new name without re-login.
      if (trigger === "update" && session?.name) {
        token.name = session.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.isAdmin = (token.isAdmin as boolean) ?? false;
      }
      return session;
    },
  },
};

/** Convenience: current session user (or null) for API routes. */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return null;
  return session.user;
}

/**
 * Like getSessionUser but re-checks isAdmin against the DB — so revoking
 * admin takes effect immediately instead of waiting for the JWT to expire.
 */
export async function getAdminUser() {
  const user = await getSessionUser();
  if (!user) return null;
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { isAdmin: true },
  });
  return dbUser?.isAdmin ? user : null;
}
