// E2E: musical director (MD) — admins flag people as MDs, and a set can be
// marked "Add MD" so auto-scheduling seats one (shown with a "* (MD)").
import { expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

test("admin flags a member as a musical director and it persists", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  // Bob isn't an MD in the seed — turn it on. Edits auto-save via a PATCH.
  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") && r.request().method() === "PATCH"
    );
  const bobMD = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" }).getByLabel("MD");

  await expect(bobMD()).not.toBeChecked();
  await Promise.all([savePatch(), bobMD().check()]);

  await page.reload();
  await expect(bobMD()).toBeChecked();

  // Restore shared state for the rest of the suite.
  await Promise.all([savePatch(), bobMD().uncheck()]);
});

test("auto-scheduling a required-MD set from its detail modal seats an MD", async ({
  page,
}) => {
  await login(page, "admin");

  // Create an EMPTY "Add MD" set from the calendar's inline "New set" form on
  // the last in-month day cell (a distinctive time keeps it from colliding
  // with other tests' ad-hoc sets there).
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();

  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "New set" })).toBeVisible();
  await form.getByLabel("Label").fill("MD Night");
  await form.getByLabel("Add MD").check();
  await form.getByLabel("Start time").fill("15:37");
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  // Open its detail modal and auto schedule: a seeded MD (jack/paul) should
  // be seated, clearing the "no MD" warning and showing the "* (MD)" marker.
  const modal = await openSetByLabel(page, "MD Night");
  await expect(
    modal.getByText(/requires an MD but none is assigned/)
  ).toBeVisible();
  await modal.getByRole("button", { name: "Auto schedule" }).click();

  await expect(
    modal.getByText(/requires an MD but none is assigned/)
  ).toHaveCount(0);
  await expect(modal.getByText("* (MD)").first()).toBeVisible();
});
