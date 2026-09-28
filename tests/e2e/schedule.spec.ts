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
import {
  clearBusyBlocks,
  login,
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
  // Requests form has its own time picker, so page-level locators are ambiguous.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  // Days are a multi-select strip and times a checkbox list: Tuesday is on by
  // default, but no time window is — pick Morning.
  await expect(
    blockOutTimes.getByRole("button", { name: "Tuesday" })
  ).toHaveAttribute("aria-pressed", "true");
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

/**
 * Bring the month grid back to the current month. The page opens focused on the
 * first request that still owes an answer, and that lens parks the calendar on
 * the request's FIRST month (July, for the seeded 2026-07-01 window) — where
 * today isn't rendered at all. Whether a request is auto-selected depends on
 * what earlier specs submitted, so this always presses the calendar's own
 * "Today" rather than assuming either state.
 */
async function showCurrentMonth(page: Page) {
  await page
    .locator("[data-tour='avail-calendar']")
    .getByRole("button", { name: "Today" })
    .click();
}

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
  // Nothing is ticked by default, and this block is an all-day one.
  await blockOutTimes.getByRole("checkbox", { name: "All day" }).click();
  await blockOutTimes.getByLabel("Repeats").selectOption("weeks");
  // Exact: the "Repeats" <select>'s accessible name includes its option text
  // ("For a number of weeks"), which a substring match would also hit.
  await blockOutTimes.getByLabel("Number of weeks", { exact: true }).fill("2");
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

  // Nothing is ticked to start with — the window is something you say, not
  // something assumed for you.
  await expect(allDay).not.toBeChecked();
  await expect(morning).not.toBeChecked();
  await expect(custom).not.toBeChecked();

  // "All day" IS every hour, so it holds the selection on its own. The other
  // rows go grey but stay live: clicking one is how you switch groups, in a
  // single click rather than untick-then-tick.
  await allDay.click();
  await expect(allDay).toBeChecked();
  await morning.click();
  await expect(allDay).not.toBeChecked();
  await expect(morning).toBeChecked();

  // Part-of-day windows stack with each other.
  const afternoon = blockOutTimes.getByRole("checkbox", {
    name: "Afternoon (12pm–5pm)",
  });
  await afternoon.click();
  await expect(morning).toBeChecked();
  await expect(afternoon).toBeChecked();

  // Custom is exclusive the same way, and brings its own From/To.
  await custom.click();
  await expect(morning).not.toBeChecked();
  await expect(afternoon).not.toBeChecked();
  await expect(blockOutTimes.getByLabel("From")).toBeVisible();

  await custom.click(); // off
  await expect(custom).not.toBeChecked();
});

test("a time window toggles from anywhere in its row", async ({ page }) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  const morning = blockOutTimes.getByRole("checkbox", {
    name: "Morning (6am–12pm)",
  });
  await expect(morning).not.toBeChecked();

  // The LABEL TEXT, not the box: these rows opt into Checkbox's `rowTarget`,
  // which wraps the row in a real <label> so the whole thing is the target —
  // a 16px box is a mean thing to aim at on a phone.
  await blockOutTimes.getByText("Morning (6am–12pm)").click();
  await expect(morning).toBeChecked();
  await blockOutTimes.getByText("Morning (6am–12pm)").click();
  await expect(morning).not.toBeChecked();
});

test("Confirm waits until a long summary has been scrolled to the end", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");

  // Block a month of days straight through the API. What's being tested is the
  // LENGTH of the summary — clicking 28 days through the calendar would be a
  // slow way to say that. The range starts a week out (so none of it is in the
  // past) and stays inside the request's own window, which is what decides
  // which days the confirmation lists (2026-07-01 → 2026-12-31, see
  // helpers.requestAvailability).
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const from = new Date();
  from.setDate(from.getDate() + 7);
  const to = new Date(from);
  to.setDate(to.getDate() + 27);
  const res = await page.request.post("/api/availability", {
    data: {
      type: "SPECIFIC",
      date: ymd(from),
      endDate: ymd(to),
      windows: [{ startMinute: 0, endMinute: 24 * 60 }],
    },
  });
  expect(res.ok()).toBeTruthy();

  await page.goto("/schedule");
  await page.getByRole("button", { name: "Submit response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  const confirm = modal.getByRole("button", { name: "Confirm" });

  // Sending 28 blocked days you haven't read is the thing being prevented.
  await expect(confirm).toBeDisabled();
  await expect(
    modal.getByText("Scroll down to review everything first.")
  ).toBeVisible();

  // Scroll the modal's own body — found by which child actually overflows,
  // rather than by a class name the layout is free to change.
  await modal.evaluate((dialog) => {
    const scroller = Array.from(dialog.querySelectorAll("div")).find(
      (d) => d.scrollHeight > d.clientHeight + 1
    );
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  });

  await expect(confirm).toBeEnabled();
  await expect(
    modal.getByText("Scroll down to review everything first.")
  ).toHaveCount(0);

  await modal.getByRole("button", { name: "Modify" }).click();
  await clearBusyBlocks(page);
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

  await showCurrentMonth(page);
  // Both the month grid and the phone week strip render a cell per day (one is
  // hidden by CSS at this width), so take the one actually on screen.
  const todayCell = page.locator(`[data-date="${todayYmd}"]:visible`).first();
  await expect(todayCell).toBeVisible();
  await todayCell.click();

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
  // The card flips to a "Completed" badge with the date it went.
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();

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
  await showCurrentMonth(page);
  // Both the month grid and the phone week strip render a cell per day (one is
  // hidden by CSS at this width), so take the one actually on screen.
  const todayCell = page.locator(`[data-date="${todayYmd}"]:visible`).first();
  await expect(todayCell).toBeVisible();
  await todayCell.click();

  // The "Block out times" picker marks it with a red "full day" dot.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific times" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  const pickerDay = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(pickerDay.locator(".bg-rose-500")).toBeVisible();
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

  // Clean up the block so it doesn't leak into later specs — and WAIT for it to
  // go. Firing the click and ending the test can close the context before the
  // DELETE lands, leaving a stray "All day" block that trips the next spec's
  // "no blocks left" check.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "All day" })
  ).toHaveCount(0);
});
