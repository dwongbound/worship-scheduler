// E2E: Availabilities tab — recurring blocks, click-to-block on the calendar,
// and the submit ("I'm done") workflow. Each test opens with an availability
// request so a request card is present.
//
// Page shape (see app/schedule/page.tsx): "Requests" is a card per availability
// request — picking one lenses the calendar onto its window and puts Submit on
// the card — and "My availability" holds the calendar, the block list, and the
// "Block out times" form that creates them.
// The phone-width pass over this page lives in mobile.spec.ts.
import { Page, expect, test } from "@playwright/test";
import { login, requestAvailability, sectionByHeading } from "./helpers";

// The calendar is desktop-only (hidden below lg), so make sure the viewport is
// wide enough for the click-to-block test.
test.use({ viewport: { width: 1280, height: 900 } });

/**
 * Delete every busy block the logged-in user has.
 *
 * The suite shares one database, so a test that leaves blocks behind changes
 * what the later ones see (a stray all-day block turns "available the whole
 * time" into a list of blocked days). Tests that add blocks call this before
 * they finish.
 */
async function clearBusyBlocks(page: Page) {
  const { entries } = (await (
    await page.request.get("/api/availability")
  ).json()) as { entries: { id: string }[] };
  for (const entry of entries) {
    await page.request.delete(`/api/availability/${entry.id}`);
  }
}

test("adds and deletes a recurring weekly block", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.getByRole("link", { name: "Availabilities", exact: true }).click();

  // "Every Tuesday morning." The section defaults to the specific-date form,
  // so switch to the weekly one first. Scope to the section — the Admin
  // Requests form has its own time picker, so page-level locators are ambiguous.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  // Days are a multi-select strip and times a checkbox list: Tuesday is on
  // by default, so just
  // swap the default "All day" window for Morning.
  await expect(
    blockOutTimes.getByRole("button", { name: "Tuesday" })
  ).toHaveAttribute("aria-pressed", "true");
  await blockOutTimes.getByRole("checkbox", { name: "All day" }).click();
  await blockOutTimes.getByRole("checkbox", { name: "Morning (6am–12pm)" }).click();
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  const entry = page.getByText(/Every Tuesday/);
  await expect(entry).toBeVisible();

  // Clean up: delete it again.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(page.getByText(/Every Tuesday/)).not.toBeVisible();
});

test("adds several weekly blocks in one submit", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // Mon–Wed, mornings AND afternoons — one submit, three stored blocks (the
  // two touching windows merge into a single 6am–5pm window per day).
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  await blockOutTimes.getByRole("button", { name: "Tuesday" }).click(); // off
  for (const day of ["Monday", "Tuesday", "Wednesday"]) {
    await blockOutTimes.getByRole("button", { name: day }).click();
  }
  await blockOutTimes.getByRole("checkbox", { name: "All day" }).click(); // off
  await blockOutTimes.getByRole("checkbox", { name: "Morning (6am–12pm)" }).click();
  await blockOutTimes
    .getByRole("checkbox", { name: "Afternoon (12pm–5pm)" })
    .click();
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  for (const day of ["Monday", "Tuesday", "Wednesday"]) {
    await expect(
      page.getByText(new RegExp(`Every ${day}, 6:00 AM`))
    ).toBeVisible();
  }

  await clearBusyBlocks(page);
});

test("stops a weekly block repeating after a number of weeks", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // "Every Thursday, for the next 2 weeks" — the stored block carries a stop
  // date, which the busy list shows as "until <date>".
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  await blockOutTimes.getByRole("button", { name: "Tuesday" }).click(); // off
  await blockOutTimes.getByRole("button", { name: "Thursday" }).click();
  await blockOutTimes.getByLabel("Repeats").selectOption("weeks");
  await blockOutTimes.getByLabel("Number of weeks").fill("2");
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  // Two weeks from today, in the same format the list uses (lib/dates
  // shortDateLabel — "9/2/26").
  const stop = new Date();
  stop.setDate(stop.getDate() + 14);
  const stopLabel = stop.toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
  });
  await expect(
    page.getByText(`Every Thursday, All day · until ${stopLabel}`)
  ).toBeVisible();

  await clearBusyBlocks(page);
});

test("All day and Custom each lock out the other windows", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  const blockOutTimes = sectionByHeading(page, "Block out times");
  const allDay = blockOutTimes.getByRole("checkbox", { name: "All day" });
  const custom = blockOutTimes.getByRole("checkbox", { name: "Custom" });
  const morning = blockOutTimes.getByRole("checkbox", {
    name: "Morning (6am–12pm)",
  });
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();

  // All day is ticked by default, and it IS every hour — so nothing else is
  // pickable until it's unticked.
  await expect(allDay).toBeChecked();
  await expect(morning).toBeDisabled();
  await expect(custom).toBeDisabled();

  // Untick it and the part-of-day windows open up, stacking with each other.
  await allDay.click();
  await expect(morning).toBeEnabled();
  await morning.click();
  await expect(
    blockOutTimes.getByRole("checkbox", { name: "Afternoon (12pm–5pm)" })
  ).toBeEnabled();

  // Custom is exclusive the same way, and brings its own From/To.
  await morning.click(); // off
  await custom.click();
  await expect(allDay).toBeDisabled();
  await expect(morning).toBeDisabled();
  await expect(blockOutTimes.getByLabel("From")).toBeVisible();

  await custom.click(); // off
  await expect(allDay).toBeEnabled();
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

  // The block shows up in the My availability list as an all-day entry. (Scope to
  // the list item — "All day" is also a time-preset <option> in the forms.)
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up so the block doesn't leak into later specs. The list Delete stays
  // disabled while the block is still optimistic (its real id hasn't arrived);
  // Playwright waits for it to enable, so this deletes the real DB row.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(blockEntry).toHaveCount(0);
});

test("submits availability and re-opens it for changes", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // The request card's "Submit response" opens a confirmation modal
  // summarizing the blocked days before actually sending.
  await page.getByRole("button", { name: "Submit response" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  // Nothing blocked → the modal says so.
  await expect(modal.getByText(/available the whole time/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  // The card flips to a "Sent" badge with the date it went.
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();

  // "Make changes" re-opens it (unsubmits).
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit response" })
  ).toBeVisible();
});

test("confirmation modal lists a blocked day, and the date picker marks it", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // A request is answered by clicking the lensed calendar — block today
  // (all-day), which falls inside the active request's window.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
  await page.locator(`[data-date="${todayYmd}"]`).click();

  // The "Block out times" picker marks it with a red "full day" dot.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific times" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  const todayCell = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(todayCell.locator(".bg-rose-500")).toBeVisible();
  await page.keyboard.press("Escape");

  // The submit-confirmation modal breaks the blocked day out instead of
  // claiming full availability.
  await page.getByRole("button", { name: "Submit response" }).click();
  const modal = page.getByRole("dialog").filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/available the whole time/)).toHaveCount(0);
  await expect(modal.getByText("All day")).toBeVisible();
  await modal.getByRole("button", { name: "Modify" }).click();
  await expect(modal).not.toBeVisible();

  // Clean up the block so it doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
});
