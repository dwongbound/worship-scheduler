// E2E: the super-admin platform surface — org creation + key rotation, plus
// admin-of-every-org access. Gated by the SUPERADMIN_EMAILS allowlist, which
// env/test.env sets to a throwaway address (never a real person's email).
import { expect, test } from "@playwright/test";
import { login, orgKey } from "./helpers";

const SUPER_EMAIL = "superadmin@example.com";

/** The nth org's NAME from the test env's ORG_KEYS ("Name:key,Name:key"). */
function orgName(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  return entry.slice(0, entry.lastIndexOf(":")).trim();
}

/** Sign up the allowlisted super-admin, join an org, land on the calendar. */
async function signUpSuperAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("First name").fill("Super");
  await page.getByLabel("Last name").fill("Admin");
  await page.getByLabel("Email").fill(SUPER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/join/);
  await page.getByLabel("Organization key").fill(orgKey(0));
  await page.getByRole("button", { name: "Join" }).click();
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

// One signup drives both super-admin capabilities (the account persists for the
// whole run, so a second signup of the same email would collide).
test("super-admin manages the platform and administers every org", async ({
  page,
}) => {
  await signUpSuperAdmin(page); // joins org 0 only, admin of none via membership

  // 1) Platform page: create an org (blank key → auto-generated) + rotate key.
  await page.getByText("Super Admin").click(); // avatar menu (super-admin only)
  await page.getByRole("link", { name: "Platform admin" }).click();
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
