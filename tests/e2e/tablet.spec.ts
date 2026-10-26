// E2E: tablet behavior — the band between `md` (768px) and `lg` (1024px),
// where the app wears BOTH halves of its chrome and neither layout is the one
// the other specs assume.
//
// What's true only here:
//   • the dense month grid IS shown (phones get the "My sets" list instead),
//   • but the floating bottom tab bar is shown too, because that's a `lg:`
//     switch and this is below it — the desktop top strip is still hidden,
//   • and the calendar takes no gestures of its own — true at every width now,
//     but this is the width where it matters most: a drag scrolls the page
//     like a page, and the weeks are moved with ‹ › or Today.
//
// This file backs the "tablet-ipad" and "tablet-android" playwright projects
// (see playwright.config.ts), the same way mobile.spec.ts backs the two phone
// ones, and the desktop project skips it. Don't set a viewport here — each
// project's device owns it, and the width is the whole point of the file.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("tablet shows the month grid AND the bottom tab bar", async ({ page }) => {
  await login(page, "nina");

  // The month grid: present here, absent on a phone. Its "Today" control is
  // the cheapest proof, being part of the grid's own header.
  await expect(page.getByRole("button", { name: "Today" })).toBeVisible();

  // The bottom bar is a `lg:hidden` element, so at this width it's the only
  // copy of each tab on the page — exactly as on a phone.
  const setsTab = page.getByRole("link", { name: "My Sets", exact: true });
  await expect(setsTab).toHaveCount(1);
  await expect(setsTab).toBeVisible();
  await setsTab.click();
  await expect(page).toHaveURL(/\/set-manager/);
});

test("the tablet calendar doesn't move under a wheel or a drag", async ({
  page,
  browserName,
}) => {
  // Playwright can't emulate a wheel in mobile WebKit ("Mouse wheel is not
  // supported"), and the wheel is the only gesture it CAN synthesise that the
  // calendar would otherwise act on — a mouse drag never reaches the touch
  // listeners on any width, so asserting on one would prove nothing. The
  // chromium tablet project covers this at the same width.
  test.skip(
    browserName === "webkit",
    "mobile WebKit can't emulate a wheel; tablet-android covers this"
  );

  await login(page, "nina");
  await page.goto("/calendar");

  const grid = page.locator("[data-no-pull]").first();
  await expect(grid).toBeVisible();
  const firstCellDate = () =>
    grid.locator("[data-date]").first().getAttribute("data-date");

  const before = await firstCellDate();
  expect(before).toBeTruthy();

  // No wheel listener anywhere on the grid, at any width — the weeks move by
  // button. The desktop spec asserts the same thing; this pins it at the width
  // where a stray listener would also fight the page's own scrolling.
  await grid.hover();
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(400); // well past the step cooldown
  expect(await firstCellDate()).toBe(before);

  // A vertical drag across the grid does nothing to it either.
  const box = await grid.boundingBox();
  expect(box).toBeTruthy();
  const midX = box!.x + box!.width / 2;
  await page.mouse.move(midX, box!.y + box!.height * 0.75);
  await page.mouse.down();
  await page.mouse.move(midX, box!.y + box!.height * 0.25, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(await firstCellDate()).toBe(before);
});

test("tablet moves through months with the arrows instead", async ({ page }) => {
  await login(page, "nina");
  await page.goto("/calendar");

  // By its month-and-year text, not by "the first h2": at this width the "My
  // sets" sidebar is on screen too, and it brings its own headings.
  const heading = page.getByRole("heading", { name: /^[A-Z][a-z]+ \d{4}$/ });
  const startedOn = await heading.textContent();
  expect(startedOn).toBeTruthy();

  // The supported way to move at this width, and it still works.
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(heading).not.toHaveText(startedOn!);

  await page.getByRole("button", { name: "Today" }).click();
  await expect(heading).toHaveText(startedOn!);
});

test("tablet follows a Preview Mode draft link", async ({ page }) => {
  // The other half of the phone case in mobile.spec.ts: a tablet is wide
  // enough, so the width gate stands aside and the link is resolved like any
  // other. The slug matches nothing on the seed, so the proof that it got
  // that far is the message about the SLUG rather than about the screen.
  await login(page, "admin");
  await page.goto("/calendar?draft=some-saved-plan");

  await expect(
    page.getByText(/doesn't match a saved plan/i)
  ).toBeVisible();
  await expect(page.getByText(/too wide for a phone screen/i)).toHaveCount(0);
});
