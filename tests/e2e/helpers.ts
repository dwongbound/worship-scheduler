// Shared e2e helpers.
import { Page, expect } from "@playwright/test";

/**
 * The nth org's join key from the test env's ORG_KEYS ("Name:key,Name:key").
 * Playwright loads env/test.env, so this matches what the app server sees.
 */
export function orgKey(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  const key = entry.slice(entry.lastIndexOf(":") + 1).trim();
  expect(key, `no ORG_KEYS entry at index ${index}`).toBeTruthy();
  return key;
}

/** Log in through the real login form. All seed users share one password. */
export async function login(
  page: Page,
  usernameOrEmail: string,
  password = "password123"
) {
  // Suppress the first-run guided tour — its full-screen overlay otherwise
  // intercepts clicks in every test. addInitScript runs before page scripts on
  // each navigation, so the "seen" flag is set for the whole session.
  await page.addInitScript(() => {
    try {
      localStorage.setItem("guided-tour-seen", "1");
    } catch {
      /* private mode — ignore */
    }
  });
  await page.goto("/login");
  await page.getByLabel("Username / Email").fill(usernameOrEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/calendar/);
}

/**
 * Open a set's detail modal by deep-linking to /calendar?set=<id> (looked up
 * by label via the API). More reliable than clicking the calendar chip, which
 * can sit in a crowded day cell's collapsed overflow. Returns the open modal.
 */
export async function openSetByLabel(page: Page, label: string) {
  const sets = (await (await page.request.get("/api/sets")).json()) as {
    id: string;
    label: string | null;
  }[];
  const match = sets.find((s) => s.label === label);
  expect(match, `no set labelled "${label}"`).toBeTruthy();

  await page.goto(`/calendar?set=${match!.id}`);
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: label })).toBeVisible();
  return modal;
}

/**
 * Create an active availability request (as admin) covering a wide range, so
 * the Availabilities page shows its input forms. Leaves the session logged in
 * as admin — callers log in as the user they want afterward.
 */
export async function requestAvailability(page: Page) {
  await login(page, "admin");
  // Admin routes are org-scoped: name the org via the x-org-id header. The
  // seeded admin administers exactly one org (the first/oldest).
  const orgs = (await (await page.request.get("/api/orgs")).json()) as {
    id: string;
    isAdmin: boolean;
  }[];
  const adminOrg = orgs.find((o) => o.isAdmin);
  expect(adminOrg, "admin has no admin org").toBeTruthy();
  const res = await page.request.post("/api/admin/availability-request", {
    headers: { "x-org-id": adminOrg!.id },
    data: { startDate: "2026-07-01", endDate: "2026-12-31" },
  });
  expect(res.ok()).toBeTruthy();
}
