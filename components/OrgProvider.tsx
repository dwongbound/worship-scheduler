"use client";
// Client-side org state: which orgs I belong to, plus the two independent
// navbar selections —
//   viewOrgId  — the Calendar / Set Manager filter ("all" or one orgId)
//   adminOrgId — the single org the admin tabs (Create / Team) operate on
// Both persist in localStorage (lib/orgPrefs.ts) and are re-validated against
// the real membership list every load, so a stale/foreign stored id can never
// select an org the user isn't in.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { fetchJsonArray } from "@/lib/api";
import {
  getStoredAdminOrg,
  getStoredViewOrg,
  storeAdminOrg,
  storeViewOrg,
} from "@/lib/orgPrefs";
import type { ApiOrg } from "@/lib/types";

// Fired after joining a new org (navbar "Add an org…" / the /join page) so
// this provider refetches memberships without a reload.
export const ORGS_CHANGED_EVENT = "orgs-changed";

interface OrgContextValue {
  // My orgs (oldest first); null while the first fetch is in flight.
  orgs: ApiOrg[] | null;
  // Calendar / Set Manager scope: "all" or one of my org ids.
  viewOrgId: string;
  setViewOrg: (orgId: string) => void;
  // The admin tabs' org (always one of my admin orgs; "" when I admin none).
  adminOrgId: string;
  setAdminOrg: (orgId: string) => void;
  isAdminOf: (orgId: string | undefined) => boolean;
  isAdminAny: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function useOrgs(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useOrgs must be used inside OrgProvider");
  return ctx;
}

export default function OrgProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  // Re-key the fetch on the user id: signing in as a DIFFERENT user without a
  // full page load (e.g. the login form's client-side redirect) must not keep
  // the previous user's org list.
  const userId = session?.user?.id;
  const [orgs, setOrgs] = useState<ApiOrg[] | null>(null);
  const [viewOrgId, setViewOrgId] = useState("all");
  const [adminOrgId, setAdminOrgId] = useState("");

  const load = useCallback(async () => {
    const list = await fetchJsonArray<ApiOrg>("/api/orgs");
    setOrgs(list);

    // Re-validate the persisted selections against what I actually belong to.
    const storedView = getStoredViewOrg();
    setViewOrgId(
      storedView !== "all" && !list.some((o) => o.id === storedView)
        ? "all"
        : storedView
    );

    const adminOrgs = list.filter((o) => o.isAdmin);
    const storedAdmin = getStoredAdminOrg();
    setAdminOrgId(
      storedAdmin && adminOrgs.some((o) => o.id === storedAdmin)
        ? storedAdmin
        : adminOrgs[0]?.id ?? "" // deterministic default: oldest admin org
    );
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !userId) return;
    load();
    window.addEventListener(ORGS_CHANGED_EVENT, load);
    return () => window.removeEventListener(ORGS_CHANGED_EVENT, load);
  }, [status, userId, load]);

  const value = useMemo<OrgContextValue>(
    () => ({
      orgs,
      viewOrgId,
      setViewOrg: (orgId) => {
        storeViewOrg(orgId);
        setViewOrgId(orgId);
      },
      adminOrgId,
      setAdminOrg: (orgId) => {
        storeAdminOrg(orgId);
        setAdminOrgId(orgId);
      },
      isAdminOf: (orgId) =>
        !!orgId && !!orgs?.some((o) => o.id === orgId && o.isAdmin),
      isAdminAny: !!orgs?.some((o) => o.isAdmin),
    }),
    [orgs, viewOrgId, adminOrgId]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}
