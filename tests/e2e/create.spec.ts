// E2E: admin-only Create tab — templates, generation, availability status.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("non-admins don't see the Create tab and can't use the page", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("link", { name: "Create" })).not.toBeVisible();

  // Direct navigation is blocked too.
  await page.goto("/create");
  await expect(
    page.getByText("You need admin access for this page.")
  ).toBeVisible();
});

test("admin can add a weekly template and generate a schedule", async ({ page }) => {
  await login(page, "admin");
  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Create Sets" })).toBeVisible();

  // Open the "add weekly set time" popup, then add "every Sunday 9:00, 90 min".
  await page.getByRole("button", { name: "Add weekly set time" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Label").fill("Sunday Service");
  await modal.getByLabel("Day of week").selectOption("0");
  await modal.getByLabel("Start time").fill("09:00");
  await modal.getByLabel("Duration").selectOption("90"); // 1.5 Hrs
  await modal.getByRole("button", { name: "Add template" }).click();
  await expect(page.getByText("every Sunday at")).toBeVisible();

  // Run the scheduler for 4 weeks — this stages a preview, it doesn't save yet.
  await page.getByLabel("Weeks ahead").fill("4");
  await page.getByRole("button", { name: "Generate preview" }).click();

  // The review modal opens; applying it commits the sets + assignments.
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await review.getByRole("button", { name: "Apply schedule" }).click();
  await expect(page.getByText(/Created \d+ sets and \d+ assignments/)).toBeVisible();
});

test("admin can set a custom team shape on a template", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  await page.getByRole("button", { name: "Add weekly set time" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Label").fill("Tuesday Morning");
  await modal.getByLabel("Day of week").selectOption("2"); // Tuesday
  await modal.getByLabel("Start time").fill("09:00");

  // Custom shape: 3 electric guitars, no acoustic guitar (opt into the editor).
  await modal.getByRole("button", { name: "Customize team shape" }).click();
  await modal.getByLabel("Electric Guitar").fill("3");
  await modal.getByLabel("Acoustic Guitar").fill("0");
  await modal.getByRole("button", { name: "Add template" }).click();

  // The template's list row summarizes only the non-default roles (regex
  // avoids the "×" glyph). Scope to the row so the assertion is unambiguous.
  const row = page.getByRole("listitem").filter({ hasText: "Tuesday Morning" });
  await expect(row).toContainText(/3.* Electric Guitar/);
  await expect(row).toContainText("no Acoustic Guitar");
});

test("admin sends an availability request to the team", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  await page.getByLabel("Name (optional)").fill("Fall 2026 Request");
  await page.getByLabel("From", { exact: true }).fill("2026-08-01");
  await page.getByLabel("To", { exact: true }).fill("2026-08-31");
  await page.getByRole("button", { name: "Request availabilities" }).click();
  await expect(
    page.getByText("Availability request sent to the team.")
  ).toBeVisible();

  // The custom name shows on the Availabilities page (both the reminder
  // banner and the request line pick it up, hence .first()).
  await page.goto("/schedule");
  await expect(page.getByText(/Fall 2026 Request/).first()).toBeVisible();
});

test("admin sees everyone's availability completion status", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  // Every seeded user appears with a scheduling status badge.
  await expect(page.getByRole("cell", { name: "Bob Baker" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kate Kim" })).toBeVisible();
  expect(await page.getByText("Not yet").count()).toBeGreaterThan(0);
});
