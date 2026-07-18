// E2E: Availabilities tab — recurring blocks, click-to-block on the calendar,
// and the submit ("I'm done") workflow. Each test opens with an availability
// request so the Admin Requests form is present.
//
// Page shape (see app/schedule/page.tsx): "Admin Requests" responds to an
// admin's window, "Block out times" adds a standalone weekly-recurring OR
// specific block behind a toggle, and "Busy Blocks" lists everything.
// The phone-width pass over this page lives in mobile.spec.ts.
import { expect, test } from "@playwright/test";
import {
  login,
  pickSingleDay,
  requestAvailability,
  sectionByHeading,
} from "./helpers";

// The calendar is desktop-only (hidden below lg), so make sure the viewport is
// wide enough for the click-to-block test.
test.use({ viewport: { width: 1280, height: 900 } });

test("adds and deletes a recurring weekly block", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.getByRole("link", { name: "Availabilities", exact: true }).click();

  // "Every Tuesday morning." The section defaults to the specific-date form,
  // so switch to the weekly one first. Scope to the section — the Admin
  // Requests form has a "Time" select too, so getByLabel alone is ambiguous.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  await blockOutTimes.getByLabel("Day of week").selectOption("2");
  await blockOutTimes.getByLabel("Time").selectOption("1"); // Morning preset
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

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

  // Scope to the Admin Requests section — its "Dates to block"/"Block these
  // dates" field+button share labels with the Block out times section below.
  const adminRequests = sectionByHeading(page, "Admin Requests");

  // Block today (an all-day block, the form's default preset) within the
  // active request's window.
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  await adminRequests.getByRole("button", { name: "Block these dates" }).click();

  // Re-opening the date picker now shows a red "full day" dot on today.
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
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
