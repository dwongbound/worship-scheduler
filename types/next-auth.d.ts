// Type augmentation so session.user.id / session.user.isAdmin typecheck.
import "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      isAdmin: boolean;
    };
  }

  interface User {
    id: string;
    isAdmin?: boolean;
    // Set by the Slack OAuth provider's profile() callback so signIn() can
    // persist it; other providers leave it undefined.
    slackUserId?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    isAdmin?: boolean;
  }
}
