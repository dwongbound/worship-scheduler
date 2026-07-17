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
  await expect(page.getByText("Saved ✓")).toBeVisible();

  // Revert so the suite's shared state is unchanged.
  await page.getByLabel("Strings").uncheck();
  await expect(page.getByText("Saved ✓")).toBeVisible();
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
  await expect(page.getByText("Saved ✓")).toBeVisible();

  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);

  // Revert so the suite's shared state (an empty-profile account) is unchanged.
  await page.getByLabel("Drums").uncheck();
  await expect(page.getByText("Saved ✓")).toBeVisible();
  await expect(page.getByTestId("profile-dot")).toBeVisible();
});

test("an established member sees no profile-setup nudge", async ({ page }) => {
  // Carol already has instruments, so neither the dot nor the banner appears.
  await login(page, "carol");
  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(page.getByText("Finish setting up your profile")).toHaveCount(0);
});
