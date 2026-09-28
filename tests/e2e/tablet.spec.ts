// E2E: tablet behavior — the band between `md` (768px) and `lg` (1024px),
// where the app wears BOTH halves of its chrome and neither layout is the one
// the other specs assume.
//
// What's true only here:
//   • the dense month grid IS shown (phones get the "My sets" list instead),
//   • but the floating bottom tab bar is shown too, because that's a `lg:`
//     switch and this is below it — the desktop top strip is still hidden,
//   • and the calendar's own gestures are OFF: dragging or wheeling inside the
//     grid does nothing, so a drag scrolls the page like a page. The weeks are
//     moved with ‹ › or Today. (components/CalendarMonth.tsx gates all of it
//     on lib/layout's BOTTOM_NAV_MAX_WIDTH.)
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

test("tablet calendar doesn't move under a wheel or a drag", async ({ page }) => {
  await login(page, "nina");
  await page.goto("/calendar");

  const grid = page.locator("[data-no-pull]").first();
  await expect(grid).toBeVisible();
  const firstCellDate = () =>
    grid.locator("[data-date]").first().getAttribute("data-date");

  const before = await firstCellDate();
  expect(before).toBeTruthy();

  // Desktop steps a week per wheel notch. Here there is no listener at all, so
  // the grid must not move — this is the assertion that would fail if the
  // width gate were dropped.
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
