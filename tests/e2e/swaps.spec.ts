// E2E: the full swap lifecycle across two users who play the same
// instrument (bob and kate are both drummers):
//   bob requests a swap → kate sees the red dot + the request →
//   kate takes the set → kate confirms all her pending sets.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("bob requests a swap on his Sunday set", async ({ page }) => {
  await login(page, "bob");
  await page.getByRole("link", { name: "Set Manager" }).click();

  // Find bob's Sunday Morning drums card and request a swap.
  const card = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Request cover" }).click();

  await expect(card.getByText("Requesting cover")).toBeVisible();
});

test("kate sees the red dot and the open swap request", async ({ page }) => {
  await login(page, "kate");

  // Red dot on the Set Manager tab (kate plays drums, so bob's request matches).
  await expect(page.getByTestId("swap-dot")).toBeVisible();

  await page.getByRole("link", { name: "Set Manager" }).click();
  const request = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .filter({ hasText: "requested by Bob Baker" });
  await expect(request).toBeVisible();
});

test("kate takes the swap and the set becomes hers (confirmed)", async ({ page }) => {
  await login(page, "kate");
  await page.goto("/swaps");

  await page
    .locator("li")
    .filter({ hasText: "requested by Bob Baker" })
    .getByRole("button", { name: "Take this set" })
    .click();

  // Taking a cover is itself the commitment, so it lands already confirmed —
  // no separate confirm step needed.
  const myCard = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .first();
  await expect(myCard.getByText("Confirmed")).toBeVisible();

  // And bob's request is gone from the open list.
  await expect(page.getByText("requested by Bob Baker")).not.toBeVisible();
});

test("kate confirms all pending sets at once", async ({ page }) => {
  await login(page, "kate");
  await page.goto("/swaps");

  await page
    .getByRole("button", { name: /Confirm all pending/ })
    .click();

  // Nothing left pending; the bulk button disappears.
  await expect(
    page.getByRole("button", { name: /Confirm all pending/ })
  ).not.toBeVisible();
  await expect(page.getByText("Pending confirmation")).not.toBeVisible();
});
