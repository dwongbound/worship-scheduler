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

  await page.getByRole("button", { name: "Submit unavailabilities" }).click();
  // Nothing blocked → confirm the "fully available" submit.
  await page.getByRole("button", { name: "Yes, I'm fully available" }).click();
  await expect(page.getByText(/Submitted on|Updated on/)).toBeVisible();

  // "Make changes" re-opens the form (unsubmits).
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit unavailabilities" })
  ).toBeVisible();
});
