// E2E: the admin-only Team page — access control + editing a person's
// instruments (which auto-saves).
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("non-admins can't see or open the Team page", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("link", { name: "Team" })).not.toBeVisible();

  await page.goto("/users");
  await expect(
    page.getByText("You need admin access for this page.")
  ).toBeVisible();
});

test("admin edits a person's instruments and it persists", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  // Bob plays only Drums — add Strings to his card. Edits save automatically
  // (optimistic UI + a background PATCH), so wait for the PATCH before reload.
  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.request().method() === "PATCH"
    );
  const bobStrings = () =>
    page
      .getByRole("listitem")
      .filter({ hasText: "Bob Baker" })
      .getByLabel("Strings");

  await expect(bobStrings()).not.toBeChecked();
  await Promise.all([savePatch(), bobStrings().check()]);

  // Reload to prove it was persisted server-side, not just local state.
  await page.reload();
  await expect(bobStrings()).toBeChecked();

  // Revert.
  await Promise.all([savePatch(), bobStrings().uncheck()]);
  await page.reload();
  await expect(bobStrings()).not.toBeChecked();
});
