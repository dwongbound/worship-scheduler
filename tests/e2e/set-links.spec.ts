// E2E: linking to one set (?set=<id>, lib/setLink.ts). The two tabs read the
// same param and answer differently on purpose — the calendar opens that set's
// roster modal (covered throughout the suite by openSetByLabel), while the
// set-manager points at the set's ROW, so the button on it (take, accept,
// confirm) is what you land next to.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a ?set= link rings the row on My Sets instead of opening it", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/set-manager");

  // Every row carries the id of the set it's about — that's what a link points
  // at, so take one from the page rather than guessing at seed data.
  const row = page.locator("[data-set-row]").first();
  await expect(row).toBeVisible();
  const setId = await row.getAttribute("data-set-row");

  await page.goto(`/set-manager?set=${setId}`);
  const linkedRow = page.locator(`[data-set-row="${setId}"]`).first();
  // Ringed, with nothing opened over it: the row's own buttons stay in reach.
  await expect(linkedRow).toHaveAttribute("data-highlighted", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the ring fades on its own", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/set-manager");
  const setId = await page
    .locator("[data-set-row]")
    .first()
    .getAttribute("data-set-row");

  await page.goto(`/set-manager?set=${setId}`);
  const linkedRow = page.locator(`[data-set-row="${setId}"]`).first();
  await expect(linkedRow).toHaveAttribute("data-highlighted", "true");
  // It's a pointer, not a state: a few seconds later the row reads normally.
  await expect(linkedRow).not.toHaveAttribute("data-highlighted", "true", {
    timeout: 10_000,
  });
});

test("a link to a set nobody can see explains itself", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/calendar?set=not-a-real-set");
  // The banner, and no modal — following a dead link mustn't just show the
  // calendar with no explanation.
  await expect(page.getByText("That set couldn't be opened")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
