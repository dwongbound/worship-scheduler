// E2E: the calendar's admin-only, desktop-only "Preview Mode" — the set-type
// picker, the read-only review workspace it opens over the REAL rosters, and
// the fact that non-admins and phones never see the button.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("admin previews the real calendar in the review workspace", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/calendar");

  await page.getByRole("button", { name: "Preview Mode" }).click();
  const options = page.getByRole("dialog");

  // Everything the calendar has is ticked by default, and each row says how
  // many sets sit behind it. Nothing on the seed matches a recurring set, so
  // there's an "Other" row.
  const other = options.getByRole("checkbox", { name: /^Other/ });
  await expect(other).toBeChecked();

  await options.getByRole("button", { name: "See preview" }).click();

  // Step 2 is the Create tab's workspace over the real schedule: Cancel /
  // Save Changes instead of Discard / Apply, and Save is dead until an edit.
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Schedule preview" })
  ).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Apply schedule" })
  ).toHaveCount(0);
  await expect(review.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  // A generated plan proposes new sets; a preview only ever mirrors existing
  // ones, so the new/existing badge sits it out.
  await expect(review.getByText("Already exists")).toHaveCount(0);

  // The cards carry the real sets, with the people already on them (the seed
  // puts Bob on drums and Carol on keys for "Sunday Morning").
  const card = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Sunday Morning" })
    .first();
  await expect(card).toBeVisible();
  await expect(card.getByText("Bob Baker")).toBeVisible();
  await expect(card.getByText("Carol Chen")).toBeVisible();

  // Both groupings work, same as the generate flow.
  await review.getByRole("button", { name: "Chronological" }).click();
  await expect(review.getByText(/^Week of /).first()).toBeVisible();

  // Nothing was edited, so Cancel just closes — no confirmation to answer.
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByLabel("Show sets for")).toBeVisible();
});

test("a card's refresh fills only that set's empty slots", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/calendar");

  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "See preview" }).click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Schedule preview" })
  ).toBeVisible();

  // "Private Rehearsal" is seeded with nobody on it — every slot open.
  const empty = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Private Rehearsal" })
    .first();
  await empty.scrollIntoViewIfNeeded();
  const emptyBefore = await empty.getByText("None", { exact: true }).count();
  expect(emptyBefore).toBeGreaterThan(0);

  // A staffed card, to prove the fill is confined to the one set.
  const staffed = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Sunday Morning" })
    .first();
  const staffedBefore = await staffed.getByText("None", { exact: true }).count();

  await empty.getByRole("button", { name: /^Auto schedule this set/ }).click();

  // Holes closed here…
  await expect(async () => {
    expect(await empty.getByText("None", { exact: true }).count()).toBeLessThan(
      emptyBefore
    );
  }).toPass();
  // …and nowhere else.
  expect(await staffed.getByText("None", { exact: true }).count()).toBe(
    staffedBefore
  );

  // The fill is an edit, so Save wakes up and leaving now asks first.
  await expect(review.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  await review.getByRole("button", { name: "Cancel" }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" });
  await expect(confirm).toBeVisible();
  // Back out of the confirmation: the preview (and the edit) survive.
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(review.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  // Now really discard — nothing was written, so the calendar is untouched.
  await review.getByRole("button", { name: "Cancel" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page.getByLabel("Show sets for")).toBeVisible();
});

test("preview mode draws only the set types you tick", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/calendar");

  await page.getByRole("button", { name: "Preview Mode" }).click();
  const options = page.getByRole("dialog");

  // Untick every row (there's one per recurring set with sets in view, plus
  // "Other" — how many depends on what the create specs have applied, so
  // untick them all rather than assuming a count): "See preview" then has
  // nothing to draw, and says why.
  const rows = options.getByRole("checkbox");
  for (const row of await rows.all()) await row.uncheck();
  const see = options.getByRole("button", { name: "See preview" });
  await expect(see).toBeDisabled();

  // Tick "Other" back on and the seeded sets come back.
  await options.getByRole("checkbox", { name: /^Other/ }).check();
  await see.click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByTestId("staged-set-card").filter({ hasText: "Sunday Morning" })
  ).not.toHaveCount(0);
});

test("preview mode is admin-only", async ({ page }) => {
  // Bob is an ordinary member of the org — no admin affordances anywhere.
  await login(page, "bob");
  await page.goto("/calendar");

  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Preview Mode" })
  ).toHaveCount(0);
});
