"use client";
// Client-side context providers. SessionProvider makes useSession() work in
// any client component; LoadingProvider gives the app one shared full-page
// loader (see components/LoadingProvider.tsx). AuthGate sits inside both so it
// can use the session + splash to hold rendering until a valid login is
// confirmed (no chrome flash for logged-out / ghost sessions).
import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import AuthGate from "@/components/AuthGate";
import LoadingProvider from "@/components/LoadingProvider";
import OrgProvider from "@/components/OrgProvider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LoadingProvider>
        <OrgProvider>
          <AuthGate>{children}</AuthGate>
        </OrgProvider>
      </LoadingProvider>
    </SessionProvider>
  );
}
