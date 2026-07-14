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
      // True when the email is in the SUPERADMIN_EMAILS allowlist. Gates the
      // navbar "Platform admin" link; server routes re-check via requireSuperAdmin.
      isSuperAdmin: boolean;
    };
  }

  interface User {
    id: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    memberships?: SessionOrgMembership[];
  }
}
