"use client";
// Shares the current user's own profile (GET /api/me) across the app. AuthGate
// already probes /api/me on first load to confirm the session's user exists;
// this provider lets that single fetch be reused by the profile and org-settings
// pages instead of each firing its own duplicate /api/me on mount.
//
//   me         — the fetched profile (null until AuthGate's probe resolves).
//   refreshMe  — refetch after a mutation that changes it (e.g. connecting
//                Slack); returns the HTTP status so AuthGate can act on a 401.
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ApiMe } from "@/lib/types";

interface MeContextValue {
  me: ApiMe | null;
  // Refetch /api/me, store it, and hand back the raw status + parsed body. A
  // 401 leaves `me` null (the caller — AuthGate — signs the ghost session out).
  refreshMe: () => Promise<{ status: number; me: ApiMe | null }>;
}

const MeContext = createContext<MeContextValue | null>(null);

export function useMe(): MeContextValue {
  const ctx = useContext(MeContext);
  if (!ctx) throw new Error("useMe must be used inside MeProvider");
  return ctx;
}

export default function MeProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<ApiMe | null>(null);

  const refreshMe = useCallback(async () => {
    const res = await fetch("/api/me");
    if (!res.ok) {
      setMe(null);
      return { status: res.status, me: null };
    }
    const body = (await res.json().catch(() => null)) as ApiMe | null;
    setMe(body);
    return { status: res.status, me: body };
  }, []);

  const value = useMemo<MeContextValue>(() => ({ me, refreshMe }), [me, refreshMe]);

  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}
