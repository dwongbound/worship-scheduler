// E2E: Availabilities tab — recurring blocks, click-to-block on the calendar,
// and the submit ("I'm done") workflow. Each test opens with an availability
// request so the specific-blocks section is present.
import { expect, test } from "@playwright/test";
import { login, requestAvailability } from "./helpers";

// The calendar is desktop-only (hidden below lg), so make sure the viewport is
// wide enough for the click-to-block test.
test.use({ viewport: { width: 1280, height: 900 } });

test("adds and deletes a recurring weekly block", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.getByRole("link", { name: "Availabilities", exact: true }).click();

  // "Every Tuesday morning." Scope to the Recurring section — the specific-block
  // form also has a "Time" select, so getByLabel alone would be ambiguous.
  const recurring = page
    .locator("section")
    .filter({ hasText: "Recurring blocks" });
  await recurring.getByLabel("Day of week").selectOption("2");
  await recurring.getByLabel("Time").selectOption("1"); // Morning preset
  await recurring.getByRole("button", { name: "Add recurring block" }).click();

  const entry = page.getByText(/Every Tuesday/);
  await expect(entry).toBeVisible();

  // Clean up: delete it again.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText(/Every Tuesday/)).not.toBeVisible();
});

test("blocks a day by clicking it on the calendar", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // Today's cell is always in-month and blockable. Clicking it creates a
  // standalone, all-day specific block (not tied to any request).
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;

  await page.locator(`[data-date="${todayYmd}"]`).click();

  // The block shows up in the Busy Blocks list as an all-day entry. (Scope to
  // the list item — "All day" is also a time-preset <option> in the forms.)
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up.
  await page.getByRole("button", { name: "Delete" }).first().click();
});

test("submits availability and re-opens it for changes", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // "Submit Response" opens a confirmation modal summarizing the blocked
  // days before actually sending.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  // Nothing blocked → the modal says so.
  await expect(modal.getByText(/available the whole time/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Submitted on|Updated on/)).toBeVisible();

  // "Make changes" re-opens the form (unsubmits).
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit Response" })
  ).toBeVisible();
});

test("confirmation modal lists a blocked day, and the date picker marks it", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // Scope to the Admin Requests section — its "Start date"/"Block these
  // dates" field+button share labels with the mobile-only Specific Blocks
  // section, which stays in the DOM (just CSS-hidden) at this desktop width.
  const adminRequests = page
    .locator("section")
    .filter({ hasText: "Admin Requests" });

  // Block today (an all-day block, the form's default preset) within the
  // active request's window.
  await adminRequests.getByLabel("Start date", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Today", exact: true }).click();
  await adminRequests.getByRole("button", { name: "Block these dates" }).click();

  // Re-opening the date picker now shows a red "full day" dot on today.
  await adminRequests.getByLabel("Start date", { exact: true }).click();
  const todayCell = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(todayCell.locator(".bg-rose-500")).toBeVisible();
  await page.keyboard.press("Escape");

  // The submit-confirmation modal breaks the blocked day out instead of
  // claiming full availability.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/available the whole time/)).toHaveCount(0);
  await expect(modal.getByText("All day")).toBeVisible();
  await modal.getByRole("button", { name: "Modify" }).click();
  await expect(modal).not.toBeVisible();

  // Clean up the block so it doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
});

test("mobile: quick-blocks a day from the Specific Blocks section", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, "carol");
  await page.goto("/schedule");

  // Desktop-only calendar is gone below lg; this section is mobile-only and
  // request-independent (no admin request needed to use it).
  const specificBlocks = page
    .locator("section")
    .filter({ hasText: "Specific Blocks" });
  await specificBlocks.getByLabel("Start date", { exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Today", exact: true }).click();
  await specificBlocks.getByRole("button", { name: "Block these dates" }).click();

  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(blockEntry).toHaveCount(0);
});
