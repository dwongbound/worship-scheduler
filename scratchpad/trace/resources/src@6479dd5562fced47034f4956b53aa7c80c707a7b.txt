// Shared e2e helpers.
import { Page, expect } from "@playwright/test";

/** Log in through the real login form. All seed users share one password. */
export async function login(
  page: Page,
  usernameOrEmail: string,
  password = "password123"
) {
  await page.goto("/login");
  await page.getByLabel("Username / Email").fill(usernameOrEmail);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/calendar/);
}

/**
 * Create an active availability request (as admin) covering a wide range, so
 * the Availabilities page shows its input forms. Leaves the session logged in
 * as admin — callers log in as the user they want afterward.
 */
export async function requestAvailability(page: Page) {
  await login(page, "admin");
  const res = await page.request.post("/api/admin/availability-request", {
    data: { startDate: "2026-07-01", endDate: "2026-12-31" },
  });
  expect(res.ok()).toBeTruthy();
}
