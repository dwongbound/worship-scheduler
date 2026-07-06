// E2E: availabilities tab — unavailability entry + "done scheduling" flag.
// The forms only appear once an admin has requested availability, so each
// test opens with requestAvailability().
import { expect, test } from "@playwright/test";
import { login, requestAvailability } from "./helpers";

test("adds and deletes a recurring weekly block", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.getByRole("link", { name: "Availabilities", exact: true }).click();

  // "Every Tuesday morning."
  await page.getByLabel("Day of week").selectOption("2");
  await page.getByLabel("Time").selectOption("1"); // Morning preset
  await page.getByRole("button", { name: "Add recurring block" }).click();

  const entry = page.getByText(/Every Tuesday/);
  await expect(entry).toBeVisible();

  // Clean up: delete it again.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText(/Every Tuesday/)).not.toBeVisible();
});

test("adds a date-range block with a note", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  await page.getByLabel("From", { exact: true }).fill("2026-08-05");
  await page.getByLabel("To", { exact: true }).fill("2026-08-10");
  await page.getByLabel("Note (optional)").fill("Out of town");
  await page.getByRole("button", { name: "Add date range" }).click();

  await expect(page.getByText("Out of town")).toBeVisible();
});

test("marks scheduling as complete and back again", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  await page.getByRole("button", { name: "I'm done scheduling" }).click();
  await expect(page.getByText(/Completed/)).toBeVisible();

  // Toggle back off so this test is self-contained.
  await page.getByRole("button", { name: "Mark as not complete" }).click();
  await expect(
    page.getByRole("button", { name: "I'm done scheduling" })
  ).toBeVisible();
});
