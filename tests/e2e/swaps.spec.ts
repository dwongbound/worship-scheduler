// E2E: the full swap lifecycle across two users who play the same
// instrument (bob and kate are both drummers):
//   bob requests a swap → kate sees the red dot + the request →
//   kate takes the set → kate confirms all her pending sets.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("bob requests a swap on his Sunday set", async ({ page }) => {
  await login(page, "bob");
  await page.getByRole("link", { name: "My Sets" }).first().click();

  // Find bob's Sunday Morning drums card and request a swap.
  const card = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .first();
  await expect(card).toBeVisible();
  // Exact: the whole card is itself a role="button" (tapping it opens the set),
  // and its accessible name is all of its text — including this button's label.
  await card.getByRole("button", { name: "Request cover", exact: true }).click();

  // A modal asks for an optional reason — leave a note, then confirm.
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Reason for cover (optional)").fill("Out of town this week");
  await modal.getByRole("button", { name: "Request cover" }).click();

  await expect(card.getByText("Requesting cover")).toBeVisible();
});

test("kate sees the red dot and the open swap request", async ({ page }) => {
  await login(page, "kate");

  // Red dot on the My Sets tab (kate plays drums, so bob's request matches).
  await expect(page.getByTestId("swap-dot")).toBeVisible();

  await page.getByRole("link", { name: "My Sets" }).first().click();
  const request = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .filter({ hasText: "requested by Bob Baker" });
  await expect(request).toBeVisible();
  // Bob's cover note rides along with the open request.
  await expect(request.getByText("Out of town this week")).toBeVisible();
});

test("kate takes the cover; it awaits admin approval, then an admin approves it", async ({
  page,
}) => {
  await login(page, "kate");
  await page.goto("/swaps");

  await page
    .locator("li")
    .filter({ hasText: "requested by Bob Baker" })
    .getByRole("button", { name: "Take this set", exact: true })
    .click();

  // Taking now hands the slot to kate but as PENDING_APPROVAL — an admin still
  // has to sign off. It drops off the open list immediately.
  const myCard = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Drums" })
    .first();
  await expect(myCard.getByText("Pending approval")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("requested by Bob Baker")).not.toBeVisible();

  // An admin approves it from the Approvals tab → it finalizes to Confirmed.
  await login(page, "admin");
  await page.goto("/approvals");
  const item = page
    .locator("li")
    .filter({ hasText: "Sunday Morning" })
    .filter({ hasText: "Kate Kim" })
    .first();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(item).not.toBeVisible();

  // Kate's slot is now confirmed.
  await login(page, "kate");
  await page.goto("/swaps");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Sunday Morning — Drums" })
      .first()
      .getByText("Confirmed")
  ).toBeVisible();
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
    .getByRole("button", { name: "Take this set", exact: true })
    .click();

  // Lands under jack as PENDING_APPROVAL (awaiting an admin), and drops off the
  // open list.
  const mine = page
    .locator("li")
    .filter({ hasText: "Prayer Cover Test" })
    .first();
  await expect(mine.getByText("Pending approval")).toBeVisible();
  await expect(page.getByText("requested by Ivy Ito")).not.toBeVisible();
});

test("an admin rejects the cover-take and it re-opens for others", async ({
  page,
}) => {
  // jack's take of "Prayer Cover Test" (previous test) is pending approval.
  await login(page, "admin");
  await page.goto("/approvals");
  const item = page
    .locator("li")
    .filter({ hasText: "Prayer Cover Test" })
    .filter({ hasText: "Jack Jones" })
    .first();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(item).not.toBeVisible();

  // Reject re-opens the cover (back to the original owner as SWAP_REQUESTED),
  // so jack — a Prayer Room keys player — sees it as takeable again.
  await login(page, "jack");
  await page.goto("/swaps");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Prayer Cover Test" })
      .filter({ hasText: "requested by Ivy Ito" })
  ).toBeVisible();
});
