// E2E: profile editing — the per-team roles a user can be scheduled for.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a user edits the roles they play on a team", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Roles are per-team: pick Carol's team first, then toggle a role on it.
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });

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

test("a brand-new member is nudged to pick their roles, then the nudge clears", async ({
  page,
}) => {
  // "newbie" (Noah New) is on the Sunday team but has no roles yet — the
  // onboarding state (needsRoles).
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

  // Pick a team, then a role — it auto-saves, and the dot and banner clear.
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });
  await page.getByLabel("Drums").check();
  await expect(page.getByTestId("profile-saved")).toBeVisible();

  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);

  // Revert so the suite's shared state (a role-less account) is unchanged.
  await page.getByLabel("Drums").uncheck();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await expect(page.getByTestId("profile-dot")).toBeVisible();
});

test("a user joins a team via the Add-a-team modal, then leaves it", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Carol is on the Sunday Team only, so Prayer Room Team is joinable.
  const teamSelect = page.getByTestId("profile-team-select");
  await expect(teamSelect).not.toContainText("Prayer Room Team");

  await page.getByRole("button", { name: "Add a team" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Prayer Room Team").check();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/me/teams/") && r.request().method() === "PUT"
    ),
    modal.getByRole("button", { name: "Add", exact: true }).click(),
  ]);

  // Joined: it's in the dropdown now, and auto-selected (roles panel shows).
  await expect(teamSelect).toContainText("Prayer Room Team");
  await expect(page.getByRole("button", { name: "Leave this team" })).toBeVisible();

  // Leave it to restore the shared seed state.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/me/teams/") && r.request().method() === "DELETE"
    ),
    page.getByRole("button", { name: "Leave this team" }).click(),
  ]);
  await expect(teamSelect).not.toContainText("Prayer Room Team");
});

test("an established member sees no profile-setup nudge", async ({ page }) => {
  // Carol already has roles on her team, so neither the dot nor banner appears.
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
  // Regression guard for the save cascade: a role toggle should be a single PUT
  // to the per-team roles endpoint plus the one aggregated GET
  // /api/notifications that refreshes the reminder dots — no session refresh, no
  // /api/orgs, no per-badge availability fetch.
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${req.method()} ${url.pathname}`);
  });

  await page.getByLabel("Strings").check();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  // Let any (unwanted) trailing requests land before asserting.
  await page.waitForTimeout(500);

  expect(
    calls.filter((c) => c.startsWith("PUT /api/me/teams/"))
  ).toHaveLength(1);
  expect(calls).not.toContain("POST /api/auth/session");
  expect(calls).not.toContain("GET /api/orgs");
  expect(calls).not.toContain("GET /api/availability-request");

  // Revert so the suite's shared state is unchanged.
  await page.getByLabel("Strings").uncheck();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
});
