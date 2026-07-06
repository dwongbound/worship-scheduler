// E2E: login flow + route protection.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("redirects unauthenticated visitors to the login page", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login/);
});

test("rejects a bad password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username / Email").fill("bob");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signs in with valid credentials and lands on the calendar", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  // Navbar shows the user's name.
  await expect(page.getByText("Bob Baker")).toBeVisible();
});

test("logs out via the user dropdown", async ({ page }) => {
  await login(page, "bob");
  await page.getByText("Bob Baker").click(); // open the avatar dropdown
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

// Login strategy 1: self-service sign-up (credentials). Creates a brand-new
// profile and lands on the calendar, signed in.
test("signs up a new account and lands on the calendar", async ({ page }) => {
  await page.goto("/login");
  // Switch to the sign-up form via the bottom toggle.
  await page.getByRole("button", { name: "Sign up" }).click();

  await page.getByLabel("First name").fill("New");
  await page.getByLabel("Last name").fill("Member");
  await page.getByLabel("Email").fill("new.member@example.com");
  await page.getByLabel("Password").fill("password123");
  // Submit (the form's own "Sign up" button).
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("New Member")).toBeVisible(); // navbar name
});

// Login strategy 2: Google SSO. A true end-to-end run needs real OAuth
// credentials (GOOGLE_CLIENT_ID/SECRET) plus a mock OAuth server to drive the
// consent redirect, so it's skipped in CI. The find-or-create-by-email
// linking lives in lib/auth.ts's signIn/jwt callbacks.
test.skip("signs in with Google (needs OAuth credentials + mock)", () => {});
