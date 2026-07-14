// E2E: the super-admin platform surface — org creation + key rotation, plus
// admin-of-every-org access. Gated by the SUPERADMIN_EMAILS allowlist, which
// env/test.env sets to a throwaway address (never a real person's email).
import { expect, test, type Page } from "@playwright/test";
import { login, orgKey } from "./helpers";

const SUPER_EMAIL = "superadmin@example.com";
const PW = "password123";

/** The nth org's NAME from the test env's ORG_KEYS ("Name:key,Name:key"). */
function orgName(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  return entry.slice(0, entry.lastIndexOf(":")).trim();
}

/**
 * Log in as the allowlisted super-admin, landing on the calendar. Idempotent:
 * creates the account on first use, and just signs in afterward. This matters
 * because Playwright retries reuse the same db (global-setup reseeds per RUN,
 * not per attempt), so a second sign-up of the same email would collide.
 */
async function loginAsSuperAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("First name").fill("Super");
  await page.getByLabel("Last name").fill("Admin");
  await page.getByLabel("Email").fill(SUPER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(PW);
  await page.getByLabel("Confirm password").fill(PW);
  await page.getByRole("button", { name: "Sign up" }).click();

  // New account → the join gate. Existing account → the sign-up errors and we
  // stay on /login, so sign in with the existing credentials instead.
  const newAccount = await page
    .waitForURL(/\/join/, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (newAccount) {
    await page.getByLabel("Organization key").fill(orgKey(0));
    await page.getByRole("button", { name: "Join" }).click();
  } else {
    await page.goto("/login"); // fresh sign-in form
    await page.getByLabel("Username / Email").fill(SUPER_EMAIL);
    await page.getByLabel("Password", { exact: true }).fill(PW);
    await page.getByRole("button", { name: "Sign in" }).click();
  }
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
}

test("redirects a non-super-admin away from /platform", async ({ page }) => {
  await login(page, "bob"); // a seeded, non-allowlisted user
  await page.goto("/platform");
  await expect(page).toHaveURL(/\/calendar/); // bounced by requireSuperAdmin
});

test("the API rejects platform calls from non-super-admins", async ({ page }) => {
  await login(page, "bob");
  const res = await page.request.get("/api/platform/orgs");
  expect(res.status()).toBe(403);
});

// One sign-up drives both super-admin capabilities (the account persists for
// the whole run, so a second sign-up of the same email would collide).
test("super-admin manages the platform and administers every org", async ({
  page,
}) => {
  await loginAsSuperAdmin(page); // joins org 0 only, admin of none via membership

  // 1) Platform page (super-admins only; non-supers are bounced — tested
  // above). Navigate directly rather than via the avatar menu.
  await page.goto("/platform");
  await expect(page.getByRole("heading", { name: "Platform admin" })).toBeVisible();

  await page.getByLabel("Name").fill("E2E New Org");
  await page.getByRole("button", { name: "Create org" }).click();
  const row = page.locator("div").filter({ hasText: /^E2E New Org/ }).first();
  await expect(page.getByText("E2E New Org")).toBeVisible();

  const keyButton = row.getByRole("button").first();
  const before = await keyButton.innerText();
  await row.getByRole("button", { name: "Rotate key" }).click();
  await expect(keyButton).not.toHaveText(before);

  // 2) Admin of EVERY org: the Create admin UI works despite no admin
  // membership, and the switcher lists an org they never joined.
  await page.goto("/create");
  await expect(page.getByLabel("Schedule for")).toBeVisible();
  await page.getByTestId("org-switcher").click();
  await expect(page.getByText(orgName(1), { exact: true })).toBeVisible();
});
