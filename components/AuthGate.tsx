"use client";
// Gates the whole app behind a confirmed, valid login so a logged-out (or
// "ghost") session never flashes the navbar/page before the redirect.
//
// Two cases it closes:
//   • unauthenticated — proxy.ts already redirects at the edge, but if a
//     client somehow reaches a protected page with no session we push to
//     /login and show the splash instead of chrome.
//   • ghost session — a NextAuth JWT stays valid even after its user row
//     disappears (account deleted, or a dev reseed rebuilt the table with new
//     ids). proxy.ts only inspects the token, so it lets the request through.
//     We probe /api/me once: a 401 means the token's user is gone → sign out.
//
// Until that probe confirms the user, we render the full-screen splash rather
// than the app, so nothing leaks before we know who (if anyone) is logged in.
// Providers mounts once for the whole app, so this gates only the first load —
// later client navigations keep `verified` and render instantly.
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import LoadingScreen from "@/components/common/LoadingScreen";

// Paths that must render for logged-out users. `/login` is the only one; its
// own chrome is already suppressed in Navbar.
function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status } = useSession();
  const isPublic = isPublicPath(pathname);
  // Flips true once /api/me confirms the session's user still exists.
  const [verified, setVerified] = useState(false);

  // Ghost-session probe: once "authenticated", confirm the user row exists.
  // The same probe routes accounts with no org membership to /join — they
  // can't use any page until they redeem an organization key.
  useEffect(() => {
    if (isPublic || status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/me")
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          // Token's user is gone — clear the cookie and send to /login.
          signOut({ callbackUrl: "/login" });
          return;
        }
        const me = await res.json().catch(() => null);
        if (cancelled) return;
        const memberships = (me?.memberships ?? []) as unknown[];
        if (memberships.length === 0 && pathname !== "/join") {
          router.replace("/join");
        }
        setVerified(true);
      })
      .catch(() => {
        // Network hiccup — don't trap the user on the splash; a real ghost
        // still 401s on the next load.
        if (!cancelled) setVerified(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, isPublic, pathname, router]);

  // Belt-and-suspenders for the no-session case (proxy.ts handles it at the
  // edge, but if we ever get here client-side, redirect rather than render).
  useEffect(() => {
    if (!isPublic && status === "unauthenticated") {
      router.replace("/login");
    }
  }, [status, isPublic, router]);

  if (isPublic) return <>{children}</>;

  // Hold the splash until we're sure of a valid, logged-in user. Once verified
  // we keep rendering the app through transient "loading" states — e.g. a
  // session `update()` (profile save) momentarily flips status to "loading";
  // dropping back to the splash there would unmount and remount the whole page
  // (flashing the splash and wiping in-page state like a "Saved!" message).
  // A real sign-out surfaces as "unauthenticated", which still shows the splash
  // while the redirect effect above sends us to /login.
  if (!verified || status === "unauthenticated") {
    return <LoadingScreen />;
  }

  return <>{children}</>;
}
