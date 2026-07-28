// E2E: profile editing — the instruments a user can be scheduled for.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a user edits the instruments they play", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Carol plays Keys + Vocals but not Strings — toggling it auto-saves (no
  // Save button; see app/profile/page.tsx).
  const strings = page.getByLabel("Strings");
  await expect(strings).not.toBeChecked();
  await strings.check();
  await expect(page.getByTestId("profile-saved")).toBeVisible();

  // Revert so the suite's shared state is unchanged.
  await page.getByLabel("Strings").uncheck();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
});

test("a brand-new member is nudged to pick their instruments, then the nudge clears", async ({
  page,
}) => {
  // "newbie" (Noah New) joins with no instruments — the onboarding state.
  await login(page, "newbie");

  // Reminder dot on the avatar + a banner prompting profile setup.
  await expect(page.getByTestId("profile-dot")).toBeVisible();
  const banner = page.getByText("Finish setting up your profile");
  await expect(banner).toBeVisible();

  // The banner links straight to the profile page.
  await page
    .getByRole("link", { name: "add the instruments and roles you play" })
    .click();
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Pick a role — it auto-saves, and the dot and banner clear without a reload.
  await page.getByLabel("Drums").check();
  await expect(page.getByTestId("profile-saved")).toBeVisible();

  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);

  // Revert so the suite's shared state (an empty-profile account) is unchanged.
  await page.getByLabel("Drums").uncheck();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await expect(page.getByTestId("profile-dot")).toBeVisible();
});

test("an established member sees no profile-setup nudge", async ({ page }) => {
  // Carol already has instruments, so neither the dot nor the banner appears.
  await login(page, "carol");
  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);
});

test("a password (non-Google) account can edit its email and password", async ({
  page,
}) => {
  // All seed users are credentials accounts (they have a password), so the
  // email field is editable and the real "Change password" button shows —
  // none of the Google-account locks apply.
  await login(page, "carol");
  await page.goto("/profile");

  await expect(page.getByLabel("Email")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Change password" })).toBeEnabled();
  await expect(page.getByText("Managed by your Google account.")).toHaveCount(0);
  await expect(page.getByText("(signed in with Google)")).toHaveCount(0);
});

test("toggling a role fires exactly one write and no session/org refetch", async ({
  page,
}) => {
  // Regression guard for the save cascade: a role toggle used to trigger a JWT
  // refresh (/api/auth/session) plus a navbar-wide refetch (/api/orgs,
  // /api/availability-request). It should now be a single PUT /api/me plus the
  // one aggregated GET /api/notifications that refreshes the reminder dots —
  // no session refresh, no /api/orgs, no per-badge availability fetch.
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${req.method()} ${url.pathname}`);
  });

  await page.getByLabel("Strings").check();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  // Let any (unwanted) trailing requests land before asserting.
  await page.waitForTimeout(500);

  expect(calls.filter((c) => c === "PUT /api/me")).toHaveLength(1);
  expect(calls).not.toContain("POST /api/auth/session");
  expect(calls).not.toContain("GET /api/orgs");
  expect(calls).not.toContain("GET /api/availability-request");

  // Revert so the suite's shared state is unchanged.
  await page.getByLabel("Strings").uncheck();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
});
