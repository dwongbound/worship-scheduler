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
  // The admin tabs live under a hover "Admin" dropdown — reveal it first.
  await page.getByRole("button", { name: "Admin", exact: true }).hover();
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

test("Slack member id entry is gated on the org having Slack connected", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  const bobCard = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" });

  // The seed org hasn't installed the Slack bot. A member's id belongs to a
  // specific workspace and is only useful once that bot exists (after which we
  // auto-resolve ids by email), so the manual-entry affordance is hidden until
  // the org connects Slack — no "Set Slack ID" and no edit control.
  await expect(
    bobCard().getByRole("button", { name: /Set Slack ID/ })
  ).toHaveCount(0);
  await expect(
    bobCard().getByRole("button", { name: "Edit Slack member ID" })
  ).toHaveCount(0);
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

test("admin opens the Team Activity log", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  await page.getByRole("button", { name: "Team Activity" }).click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("heading", { name: "Team Activity" })
  ).toBeVisible();
  // The activity-type filter is present (the log itself may be empty).
  await expect(modal.getByLabel("Activity")).toBeVisible();
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

// Note: per-set auto group chats are configured on the set/template now (see the
// set detail modal and the recurring-set form), not on the team, so there's no
// team-level lead-time control here anymore.
