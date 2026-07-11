// E2E: profile editing — the instruments a user can be scheduled for.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a user edits the instruments they play", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Carol plays Keys + Vocals but not Strings — add it and save.
  const strings = page.getByLabel("Strings");
  await expect(strings).not.toBeChecked();
  await strings.check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved!")).toBeVisible();

  // Revert so the suite's shared state is unchanged.
  await page.getByLabel("Strings").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved!")).toBeVisible();
});
