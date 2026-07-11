// Client-side persistence of the navbar org-switcher (same try/catch pattern
// as lib/theme.ts). Two independent selections:
//   "org:view"  — Calendar / Set Manager filter: "all" or one orgId
//   "org:admin" — the single org the admin tabs (Create / Team) operate on
// Stored values are just hints; OrgProvider re-validates them against the
// user's actual memberships every load.

const VIEW_KEY = "org:view";
const ADMIN_KEY = "org:admin";

export function getStoredViewOrg(): string {
  try {
    return localStorage.getItem(VIEW_KEY) ?? "all";
  } catch {
    return "all";
  }
}

export function storeViewOrg(orgId: string): void {
  try {
    localStorage.setItem(VIEW_KEY, orgId);
  } catch {
    // ignore write failures
  }
}

export function getStoredAdminOrg(): string | null {
  try {
    return localStorage.getItem(ADMIN_KEY);
  } catch {
    return null;
  }
}

export function storeAdminOrg(orgId: string): void {
  try {
    localStorage.setItem(ADMIN_KEY, orgId);
  } catch {
    // ignore write failures
  }
}
