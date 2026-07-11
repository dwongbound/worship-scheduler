// Type augmentation so session.user.id / session.user.memberships typecheck.
import "next-auth";

// A user's org memberships as carried on the JWT/session. UI-ONLY hints
// (tab visibility, org dropdown) — server routes always re-check the db.
export interface SessionOrgMembership {
  orgId: string;
  isAdmin: boolean;
}

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      memberships: SessionOrgMembership[];
    };
  }

  interface User {
    id: string;
    // Set by the Slack OAuth provider's profile() callback so signIn() can
    // persist it; other providers leave it undefined.
    slackUserId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    memberships?: SessionOrgMembership[];
  }
}
