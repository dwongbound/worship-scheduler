// E2E: linking to one set (?set=<id>, lib/setLink.ts). The two tabs read the
// same param and answer differently on purpose — the calendar opens that set's
// roster modal (covered throughout the suite by openSetByLabel), while the
// set-manager points at the set's ROW, so the button on it (take, accept,
// confirm) is what you land next to.
import { expect, test } from "@playwright/test";
import { gotoReady, login } from "./helpers";

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

test("a set opened by a ?set= link can be closed again", async ({ page }) => {
  // The calendar-invite case. The modal's every exit drops the param, and
  // dropping it is what closes the modal — so a navigation the router quietly
  // discards leaves the set open with no way out (lib/urlParam.ts).
  await login(page, "carol");
  await page.goto("/set-manager");
  const setId = await page
    .locator("[data-set-row]")
    .first()
    .getAttribute("data-set-row");

  await page.goto(`/calendar?set=${setId}`);
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // And the param is gone, so a refresh doesn't reopen what you just closed.
  await expect.poll(() => new URL(page.url()).search).toBe("");
});

test("Escape closes a linked set too", async ({ page }) => {
  // Same guard for the other exits: the ✕, Escape and the backdrop all run
  // the same close, so one of them standing in for the rest is enough.
  await login(page, "carol");
  await page.goto("/set-manager");
  const setId = await page
    .locator("[data-set-row]")
    .first()
    .getAttribute("data-set-row");

  await page.goto(`/calendar?set=${setId}`);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a set opened from the grid puts its link in the address bar", async ({
  page,
}) => {
  // The other half: opening a set MIRRORS its id into the URL, which is what
  // makes the address bar shareable — and the same discarded navigation meant
  // the modal opened over an unchanged URL.
  await login(page, "admin");
  await gotoReady(page, "/calendar");

  // A set's own chip, by the title it carries ("<label> · <time>") — a day
  // cell holds an admin's "add a set" button too, and that opens a different
  // modal. The wait is for the sets to arrive rather than an empty month.
  const chip = page.locator('[data-date] button[title*="\u00b7"]').first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("set")).toBeTruthy();

  // And closing clears it again.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).search).toBe("");
});
