"use client";
// Client-side context providers. SessionProvider makes useSession() work in
// any client component; LoadingProvider gives the app one shared full-page
// loader (see components/LoadingProvider.tsx).
import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
import LoadingProvider from "@/components/LoadingProvider";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <LoadingProvider>{children}</LoadingProvider>
    </SessionProvider>
  );
}
