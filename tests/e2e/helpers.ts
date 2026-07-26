// Shared e2e helpers.
import { Locator, Page, expect } from "@playwright/test";

/**
 * The <section> whose own <h2> is `heading`.
 *
 * Prefer this over `.filter({ hasText })` for page sections: several headings
 * are also mentioned in neighbouring prose (the Availabilities page name-drops
 * "Block out times" inside the Admin Requests card), and hasText matches any
 * descendant text — so it silently resolves to two sections and the call fails
 * on strict mode. Matching on the heading element pins it to the real one.
 */
export function sectionByHeading(page: Page, heading: string): Locator {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
}

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

/**
 * In an already-open DateSelect popup, pick today as a one-day range.
 *
 * The availability forms use `range` DateSelects, where the first click sets
 * the range start and leaves the popup open for the end; a second "Today" click
 * completes it as a single day and closes the popup. One click alone would
 * leave a half-open range, an unfilled field, and a disabled submit button.
 *
 * We click until the popup actually closes rather than assuming exactly two.
 * On WebKit the two clicks can outrun React's re-render, so the second click
 * reads the stale "no start yet" state and just re-opens a start; retrying
 * until the "Today" button is gone rides that out (and is a no-op extra check
 * on Chromium, where two clicks already suffice).
 */
export async function pickSingleDay(page: Page) {
  const dialog = page.getByRole("dialog");
  // Today's grid cell — the enabled button carrying today's day number (the
  // same number in a padding month is rendered disabled, so exclude those).
  const todayCell = dialog
    .getByRole("button", { name: String(new Date().getDate()), exact: true })
    .and(page.locator("button:not([disabled])"));

  // One click sets the range start, which both availability forms accept as a
  // single-day block (they require only the start; endDate is optional). We
  // deliberately do NOT complete the range with a second same-day click: on
  // WebKit that second click is unreliable and left the popup open. Confirm the
  // start committed (the cell renders selected) — retrying because on WebKit a
  // click can land just before React commits.
  await expect(async () => {
    await todayCell.click();
    await expect(todayCell).toHaveClass(/bg-indigo-600/, { timeout: 1500 });
  }).toPass({ timeout: 10_000 });

  // Close the picker so the form's submit button underneath is interactable.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Suppress the first-run guided tour — its full-screen overlay otherwise
 * intercepts clicks in every test. addInitScript runs before page scripts on
 * each navigation, so the "seen" flag is set for the whole session. Any test
 * that doesn't go through `login()` (e.g. a custom sign-up flow) must call
 * this itself before its first navigation.
 */
export async function suppressGuidedTour(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("guided-tour-seen", "1");
    } catch {
      /* private mode — ignore */
    }
  });
}

/** Log in through the real login form. All seed users share one password. */
export async function login(
  page: Page,
  usernameOrEmail: string,
  password = "password123"
) {
  await suppressGuidedTour(page);
  await page.goto("/login");
  const userField = page.getByLabel("Username / Email");
  const passField = page.getByLabel("Password");
  // Fill and confirm both values stick before submitting. On WebKit (the
  // iPhone project) two things can silently wipe a just-filled field: React
  // hydration resetting a controlled input typed into before it's interactive,
  // and Safari credential-autofill clearing the username once the password is
  // populated. Filling password first / username last dodges the autofill, and
  // the toPass retry rides out the hydration race — a plain fill() left the
  // username empty and every login failed. Chromium is unaffected either way.
  await expect(async () => {
    await passField.fill(password);
    await userField.fill(usernameOrEmail);
    await expect(passField).toHaveValue(password);
    await expect(userField).toHaveValue(usernameOrEmail);
  }).toPass({ timeout: 10_000 });
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
