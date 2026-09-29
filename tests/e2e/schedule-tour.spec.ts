// E2E: the review workspace's guided tour — the Help button, the first-run
// auto-open, and the fact that it says different things in the two modes the
// same workspace serves.
//
// The tour is now the ONLY explanation of that screen: the instructions that
// used to sit at the top of the modal and the shortcut hint under them were
// both deleted in its favour. So "does it open" is a real coverage question,
// not a cosmetic one.
import { expect, test } from "@playwright/test";
import { allowScheduleTours, login } from "./helpers";

// Open the calendar's Preview Mode and return the review dialog behind it.
async function openPreviewMode(page: import("@playwright/test").Page) {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "See preview" }).click();
  return page.getByRole("dialog").filter({ hasText: "Schedule preview" });
}

// The tour modal itself, told apart from the workspace it sits over.
const tourOf = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog").filter({ hasText: "Guided tour" });

test("the tour opens itself the first time, then leaves you alone", async ({
  page,
}) => {
  await login(page, "admin");
  await allowScheduleTours(page);

  await openPreviewMode(page);

  // Unasked, on arrival — this browser has never seen this workspace.
  const tour = tourOf(page);
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Step 1 of 9")).toBeVisible();

  // Back is dead on the first step; Next walks forward.
  await expect(tour.getByRole("button", { name: "Back" })).toBeDisabled();
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 2 of 9")).toBeVisible();
  await tour.getByRole("button", { name: "Back" }).click();
  await expect(tour.getByText("Step 1 of 9")).toBeVisible();

  // Walk to the end. The last step commits rather than advancing.
  for (let i = 0; i < 8; i++) {
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour.getByText("Step 9 of 9")).toBeVisible();
  await tour.getByRole("button", { name: "Done" }).click();
  await expect(tour).toBeHidden();

  // Closing it is what records "seen" — reopening the workspace is quiet now.
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await openPreviewMode(page);
  await expect(tourOf(page)).toBeHidden();
});

test("Help brings the tour back, from the top", async ({ page }) => {
  await login(page, "admin"); // tours suppressed — nothing auto-opens
  const review = await openPreviewMode(page);
  await expect(tourOf(page)).toBeHidden();

  await review.getByRole("button", { name: "Help" }).click();
  const tour = tourOf(page);
  await expect(tour).toBeVisible();
  await expect(tour.getByText("Step 1 of 9")).toBeVisible();

  // Move off step one, close, reopen — a tour you asked for starts at the
  // start, not where you abandoned it.
  await tour.getByRole("button", { name: "Next" }).click();
  await expect(tour.getByText("Step 2 of 9")).toBeVisible();
  // Mid-tour there is no Done — you leave with Escape or the ✕. Escape must
  // take the tour ONLY: the workspace behind it listens for Escape too, and
  // losing the plan because you dismissed its help would be unforgivable.
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  await expect(review).toBeVisible();
  await review.getByRole("button", { name: "Help" }).click();
  await expect(tour.getByText("Step 1 of 9")).toBeVisible();
});

test("the tour describes the mode it was opened in", async ({ page }) => {
  await login(page, "admin");

  // Preview Mode has no draft to park and commits with Save Changes.
  const review = await openPreviewMode(page);
  await review.getByRole("button", { name: "Help" }).click();
  const tour = tourOf(page);
  for (let i = 0; i < 8; i++) {
    await tour.getByRole("button", { name: "Next" }).click();
  }
  await expect(tour.getByRole("heading", { name: "Saving your changes" })).toBeVisible();
  // Pinned to the prose: the step's little illustration says "Save Changes" too.
  await expect(
    tour.getByText(/Save Changes is the only thing that writes/)
  ).toBeVisible();
  // Nowhere on the step — not in the words, and not in the drawing of the
  // action bar, which has to be the bar this mode actually shows.
  await expect(tour.getByText(/Save Draft/)).toHaveCount(0);
  await tour.getByRole("button", { name: "Done" }).click();
  await review.getByRole("button", { name: "Cancel" }).click();

  // The generate flow does have drafts, and applies rather than saves.
  await page.goto("/create");
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const scope = options.getByLabel("Schedule for");
  const reqValue = await scope
    .locator('option[value^="req:"]')
    .first()
    .getAttribute("value");
  await scope.selectOption(reqValue!);
  await options.getByRole("button", { name: "Generate preview" }).click();
  const staged = page
    .getByRole("dialog")
    .filter({ hasText: "Review generated schedule" });
  await expect(staged).toBeVisible();

  await staged.getByRole("button", { name: "Help" }).click();
  const genTour = tourOf(page);
  for (let i = 0; i < 8; i++) {
    await genTour.getByRole("button", { name: "Next" }).click();
  }
  await expect(
    genTour.getByRole("heading", { name: "Drafts, and applying" })
  ).toBeVisible();
  await expect(genTour.getByText(/Save Draft parks the whole plan/)).toBeVisible();
});

test("the old instruction wall is gone from the workspace itself", async ({
  page,
}) => {
  await login(page, "admin");
  const review = await openPreviewMode(page);

  // Everything below moved into the tour. Its absence is the feature.
  await expect(review.getByText(/Move people around/)).toHaveCount(0);
  await expect(review.getByText(/stays put if you re-run auto schedule/)).toHaveCount(0);
  await expect(review.getByText(/copies its roles and people/)).toHaveCount(0);

  // What's left is the bare tally.
  await expect(review.getByText(/\d+ sets? · \d+ assignments?/)).toBeVisible();
});
