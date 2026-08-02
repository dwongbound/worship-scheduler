// E2E: the admin-only Team page — access control + editing a person's per-team
// roles (which auto-saves).
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

test("admin edits a person's team roles and it persists", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  // Roles are per-team: pick the Sunday team so its members' role checkboxes
  // show (the picker resets to "All members" on reload, so re-select each time).
  // Bob plays only Drums there — add Strings. Edits save automatically
  // (optimistic UI + a background PATCH), so wait for the PATCH before reload.
  const pickSunday = () =>
    page.getByTestId("team-filter").selectOption({ label: "Sunday Team" });
  await pickSunday();

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
  await pickSunday();
  await expect(bobStrings()).toBeChecked();

  // Revert.
  await Promise.all([savePatch(), bobStrings().uncheck()]);
  await page.reload();
  await pickSunday();
  await expect(bobStrings()).not.toBeChecked();
});

test("admin sets and clears a person's Slack member id", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  const bobCard = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" });
  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.request().method() === "PATCH"
    );
  const slackInput = () =>
    bobCard().getByLabel("Slack member ID for Bob Baker");

  // Bob has no Slack id in the seed → his card offers "Set Slack ID".
  await bobCard().getByRole("button", { name: /Set Slack ID/ }).click();
  await slackInput().fill("U123TEST");
  await Promise.all([
    savePatch(),
    bobCard().getByRole("button", { name: "Save" }).click(),
  ]);

  // It now shows the connected (editable) Slack mark, and it persists.
  await expect(
    bobCard().getByRole("button", { name: "Edit Slack member ID" })
  ).toBeVisible();
  await page.reload();
  await expect(
    bobCard().getByRole("button", { name: "Edit Slack member ID" })
  ).toBeVisible();

  // Clearing it (blank save) restores the shared seed state.
  await bobCard().getByRole("button", { name: "Edit Slack member ID" }).click();
  await slackInput().fill("");
  await Promise.all([
    savePatch(),
    bobCard().getByRole("button", { name: "Save" }).click(),
  ]);
  await expect(
    bobCard().getByRole("button", { name: /Set Slack ID/ })
  ).toBeVisible();
});

test("admin removes a person from a team via the chip's x", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.request().method() === "PATCH"
    );
  const bobCard = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" });
  // Bob is on the Sunday Team (seed) — his card shows a chip with a remove x.
  const removeBtn = bobCard().getByRole("button", {
    name: "Remove Bob Baker from Sunday Team",
  });

  await expect(removeBtn).toBeVisible();
  await Promise.all([savePatch(), removeBtn.click()]);

  // The chip's remove control is gone once he's off the team; it persists.
  await expect(removeBtn).toHaveCount(0);
  await page.reload();
  await expect(
    bobCard().getByRole("button", { name: "Remove Bob Baker from Sunday Team" })
  ).toHaveCount(0);

  // Revert via the card's "+ Add to team" chip so the shared seed is untouched.
  await bobCard().getByText("+ Add to team").click();
  await Promise.all([
    savePatch(),
    page.getByRole("button", { name: "Sunday Team", exact: true }).click(),
  ]);
  await page.reload();
  await expect(
    bobCard().getByRole("button", { name: "Remove Bob Baker from Sunday Team" })
  ).toBeVisible();
});

test("admin opens the team management modal from the Teams card", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  // The Teams card lists each team as a clickable button (name + member count).
  await page
    .getByRole("button", { name: /Sunday Team\s*\d+ members/ })
    .click();

  // It opens the same shared modal the Org settings page uses.
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: "Sunday Team" })).toBeVisible();
  await expect(modal.getByText(/Members \(\d+\)/)).toBeVisible();
  await expect(modal.getByLabel("Add member")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Delete team" })).toBeVisible();

  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).not.toBeVisible();
});

test("admin sets a team's auto group-chat lead time and it persists", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/users");

  const openSunday = () =>
    page.getByRole("button", { name: /Sunday Team\s*\d+ members/ }).click();
  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        /\/api\/teams\/[^/]+$/.test(r.url()) && r.request().method() === "PATCH"
    );

  await openSunday();
  const leadSelect = () =>
    page.getByRole("dialog").getByLabel("Create the chat");
  await expect(leadSelect()).toHaveValue(""); // off by default

  await Promise.all([savePatch(), leadSelect().selectOption("3")]);

  // Persisted: reload, reopen, still "3 days before".
  await page.reload();
  await openSunday();
  await expect(leadSelect()).toHaveValue("3");

  // Restore the shared seed state.
  await Promise.all([savePatch(), leadSelect().selectOption("")]);
});
