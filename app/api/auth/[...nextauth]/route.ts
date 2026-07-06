// NextAuth catch-all route. All the real config lives in lib/auth.ts.
import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
