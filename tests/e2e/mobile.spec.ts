// E2E: phone behavior. The app swaps to a mobile layout below the `sm`/`md`/`lg`
// breakpoints — a floating bottom tab bar replaces the top strip, the calendar
// tab shows a "My sets" list instead of the dense month grid, the Availabilities
// calendar drops away, and desktop-only affordances (the .ics export) hide.
//
// This file IS the "mobile" playwright project (see playwright.config.ts): it
// runs under the Pixel 5 device preset — 393x851, mobile UA, touch — and the
// desktop project skips it. So don't set a viewport here; the project owns it.
import { expect, test } from "@playwright/test";
import {
  login,
  pickSingleDay,
  requestAvailability,
  sectionByHeading,
} from "./helpers";

test("phone shows the bottom tab bar and navigates with it", async ({ page }) => {
  await login(page, "bob");

  // The desktop tab strip is display:none on phones (getByRole ignores hidden),
  // so its full "Set Manager" label isn't reachable...
  await expect(page.getByRole("link", { name: "Set Manager" })).toHaveCount(0);
  // ...while the bottom bar's short "Sets" label is, and it navigates.
  const setsTab = page.getByRole("link", { name: "Sets", exact: true });
  await expect(setsTab).toBeVisible();
  await setsTab.click();

  await expect(page).toHaveURL(/\/swaps/);
  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
});

test("phone calendar shows the My sets list, not the month grid", async ({ page }) => {
  // nina rather than bob: swaps.spec.ts hands bob's Sunday Morning drums to
  // kate, and the whole mobile project runs after the whole desktop one against
  // a db that global-setup seeds once per run — so by the time we get here bob
  // has no Sunday set left. Nothing mutates nina's roster; keep it that way, or
  // move this to another user no spec touches.
  await login(page, "nina");

  // The desktop month grid is hidden — its month-nav "Today" button isn't shown.
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);

  // Instead, the mobile "My sets" list is shown; tapping a set opens its roster.
  const setCard = page.getByText("Sunday Morning").filter({ visible: true }).first();
  await expect(setCard).toBeVisible();
  await setCard.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Worship Leader")).toBeVisible();
});

test("phone Set Manager hides the desktop-only .ics export", async ({ page }) => {
  await login(page, "bob");
  await page.goto("/swaps");

  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
  // The export button is desktop-only (hidden sm:block) — present but not shown.
  await expect(page.getByText("Export my sets (.ics)")).toBeHidden();
});

test("phone Availabilities blocks a day without the desktop calendar", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/schedule");

  // The click-to-block calendar is desktop-only (hidden below lg), so on a
  // phone "Block out times" is the only way to add a block. It needs no admin
  // request, unlike the Admin Requests form above it.
  await expect(page.locator("[data-tour='avail-calendar']")).toBeHidden();

  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific date(s)" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  await blockOutTimes.getByRole("button", { name: "Block these dates" }).click();

  // It lands in the Busy Blocks list as an all-day entry.
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up so the block doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(blockEntry).toHaveCount(0);
});

test("phone: adds and deletes a recurring weekly block via the single-panel adder", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/schedule");

  // The single "Block out times" panel does both block kinds behind a toggle;
  // it defaults to specific, so switch to the weekly mode. This is the same
  // adder the desktop test drives — here at phone width, where it stacks to one
  // column instead of the sm two-column grid.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  await blockOutTimes.getByLabel("Day of week").selectOption("2"); // Tuesday
  await blockOutTimes.getByLabel("Time").selectOption("1"); // Morning preset
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  const entry = page.getByText(/Every Tuesday/);
  await expect(entry).toBeVisible();

  // Clean up.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(entry).not.toBeVisible();
});

test("phone: submits an availability response and re-opens it for changes", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // The submit-confirmation modal is viewport-independent; make sure the whole
  // "Submit Response" → confirm → "Make changes" loop works on a phone too.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  // Nothing blocked → the modal says so.
  await expect(modal.getByText(/available the whole time/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Submitted on|Updated on/)).toBeVisible();

  // "Make changes" re-opens the form (unsubmits) so the response can be edited.
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit Response" })
  ).toBeVisible();
});

test("phone: confirmation modal lists a blocked day, and the date picker marks it", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  const adminRequests = sectionByHeading(page, "Admin Requests");

  // Block today (an all-day block, the form's default preset) within the
  // active request's window.
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  await adminRequests.getByRole("button", { name: "Block these dates" }).click();

  // Re-opening the picker shows a red "full day" dot on today (the dayMarker).
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
  const todayCell = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(todayCell.locator(".bg-rose-500")).toBeVisible();
  await page.keyboard.press("Escape");

  // The submit-confirmation modal breaks the blocked day out instead of
  // claiming full availability.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/available the whole time/)).toHaveCount(0);
  await expect(modal.getByText("All day")).toBeVisible();
  await modal.getByRole("button", { name: "Modify" }).click();
  await expect(modal).not.toBeVisible();

  // Clean up the block so it doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
});
