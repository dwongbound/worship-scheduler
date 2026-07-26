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

// ── Team-scoped covers ──────────────────────────────────────────────────
// Ivy (Prayer Room + keys) has a seeded open cover on "Prayer Cover Test".
// A cover is offered only to members of the set's team: Prayer Room keys
// players (jack) see it; a Sunday-only keys player (carol) does not.

test("a teammate on the set's team sees the team-scoped cover", async ({ page }) => {
  await login(page, "jack"); // Prayer Room + plays keys
  await page.goto("/swaps");

  const request = page
    .locator("li")
    .filter({ hasText: "Prayer Cover Test" })
    .filter({ hasText: "requested by Ivy Ito" });
  await expect(request).toBeVisible();
});

test("someone off the set's team never sees the cover", async ({ page }) => {
  await login(page, "carol"); // plays keys, but Sunday Team only (not Prayer Room)
  await page.goto("/swaps");

  // Carol plays the right instrument and is in the same org, but the cover is
  // team-scoped, so it must not appear for her.
  await expect(page.getByText("Prayer Cover Test")).toHaveCount(0);

  // And the API refuses if she tries to take it directly (403 — wrong team).
  const swaps = (await (await page.request.get("/api/sets")).json()) as {
    label: string;
    assignments: { id: string; role: string; status: string }[];
  }[];
  const cover = swaps.find((s) => s.label === "Prayer Cover Test");
  const slot = cover?.assignments.find((a) => a.status === "SWAP_REQUESTED");
  expect(slot, "seeded open cover slot").toBeTruthy();
  const res = await page.request.post(`/api/swaps/${slot!.id}/take`);
  expect(res.status()).toBe(403);
});

test("a teammate can take the team-scoped cover", async ({ page }) => {
  await login(page, "jack");
  await page.goto("/swaps");

  await page
    .locator("li")
    .filter({ hasText: "Prayer Cover Test" })
    .getByRole("button", { name: "Take this set" })
    .click();

  // Lands already confirmed under jack, and drops off the open list.
  const mine = page
    .locator("li")
    .filter({ hasText: "Prayer Cover Test" })
    .first();
  await expect(mine.getByText("Confirmed")).toBeVisible();
  await expect(page.getByText("requested by Ivy Ito")).not.toBeVisible();
});
