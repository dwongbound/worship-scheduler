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

  // Step 2 is the Create tab's workspace over the real schedule: Close /
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

  // All three groupings work, same as the generate flow: week headings appear
  // in the weekly view and are gone again in the linear one, which files every
  // set under a single band.
  await review
    .getByRole("button", { name: "Chronological (week)", exact: true })
    .click();
  await expect(review.getByText(/^Week of /).first()).toBeVisible();
  await review
    .getByRole("button", { name: "Chronological (linear)", exact: true })
    .click();
  await expect(review.getByText(/^Week of /)).toHaveCount(0);
  await expect(review.getByText("In date order")).toBeVisible();

  // Nothing was edited, so Cancel just closes — no confirmation to answer.
  await review.getByRole("button", { name: "Close", exact: true }).click();
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
  await review.getByRole("button", { name: "Close", exact: true }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" });
  await expect(confirm).toBeVisible();
  // Back out of the confirmation: the preview (and the edit) survive.
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(review.getByRole("button", { name: "Save Changes" })).toBeEnabled();
  // Now really discard — nothing was written, so the calendar is untouched.
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await expect(page.getByLabel("Show sets for")).toBeVisible();
});

test("auto schedule keeps the locked calendar and saves as one confirmed batch", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "See preview" }).click();
  const review = page.getByRole("dialog").filter({ hasText: "Schedule preview" });
  await expect(
    review.getByRole("heading", { name: "Schedule preview" })
  ).toBeVisible();

  // Everything already on the calendar opens locked, so the toggle offers to
  // undo that — and flips back and forth.
  const unlockAll = review.getByRole("button", { name: /Unlock all/ });
  await expect(unlockAll).toBeVisible();
  await unlockAll.click();
  await review.getByRole("button", { name: /Lock all/ }).click();
  await expect(unlockAll).toBeVisible();

  const staffed = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Sunday Morning" })
    .filter({ hasText: "Carol Chen" })
    .first();
  const empty = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Private Rehearsal" })
    .first();
  await empty.scrollIntoViewIfNeeded();
  const emptyBefore = await empty.getByText("None", { exact: true }).count();

  // The plan-wide fill: open seats close, locked people stay exactly put.
  await review.getByRole("button", { name: "Auto schedule", exact: true }).click();
  await expect(async () => {
    expect(await empty.getByText("None", { exact: true }).count()).toBeLessThan(
      emptyBefore
    );
  }).toPass();
  await expect(staffed.getByText("Carol Chen")).toBeVisible();
  await expect(staffed.getByText("Bob Baker")).toBeVisible();

  // Saving goes through ONE batch request — intercepted here so the shared
  // seed stays as the other specs expect it.
  let sent: { sets: { setId: string; added?: unknown[] }[] } | null = null;
  await page.route("**/api/admin/sets/roster", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, applied: 1 } });
  });

  // Save asks first, and says how much it's about to change.
  await review.getByRole("button", { name: "Save Changes" }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Save these changes?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/across \d+ sets? in one batch/)).toBeVisible();
  // Close backs out of the confirm without saving or leaving the preview.
  await confirm.getByRole("button", { name: "Close", exact: true }).click();
  await expect(confirm).not.toBeVisible();
  expect(sent).toBeNull();

  await review.getByRole("button", { name: "Save Changes" }).click();
  // The confirm's commit button reads "Save anyway" when the plan has seats
  // that break a scheduling rule, and "Save Changes" when it doesn't — the
  // seeded roster can go either way, and neither is ever disabled.
  await confirm
    .getByRole("button", { name: /^Save (Changes|anyway)$/ })
    .click();
  await expect(review).not.toBeVisible();
  expect(sent).not.toBeNull();
  // Only edited sets travel, and the locked Sunday crew wasn't one of them.
  expect(sent!.sets.length).toBeGreaterThan(0);
  expect(sent!.sets.every((s) => s.setId)).toBe(true);
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

test("preview mode parks a roster as a draft and lays it back on", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/calendar");

  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "See preview" }).click();
  const review = page.getByRole("dialog").filter({ hasText: "Schedule preview" });
  await expect(
    review.getByRole("heading", { name: "Schedule preview" })
  ).toBeVisible();

  // Nothing is edited yet, so there is nothing worth parking either.
  await expect(review.getByRole("button", { name: "Save Draft" })).toBeDisabled();

  // Fill the empty seeded set — the edit this draft is about to carry.
  const empty = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Private Rehearsal" })
    .first();
  await empty.scrollIntoViewIfNeeded();
  const openBefore = await empty.getByText("None", { exact: true }).count();
  await empty.getByRole("button", { name: /^Auto schedule this set/ }).click();
  await expect(async () => {
    expect(await empty.getByText("None", { exact: true }).count()).toBeLessThan(
      openBefore
    );
  }).toPass();

  const saveDraft = review.getByRole("button", { name: "Save Draft" });
  await expect(saveDraft).toBeEnabled();
  await saveDraft.click();
  const saveDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Save this preview as a draft?" });
  await saveDialog.getByLabel("Name (optional)").fill("Rehearsal crew");
  await saveDialog.getByRole("button", { name: "Confirm" }).click();

  // Parking it leaves the workspace, and the calendar is untouched: a draft is
  // the one way out of here that writes nothing and messages nobody.
  await expect(review).toBeHidden();

  // The picker now offers the drafts behind it.
  await page.getByRole("button", { name: "Preview Mode" }).click();
  const options = page.getByRole("dialog").filter({ hasText: "Set types to show" });
  await options.getByRole("button", { name: "Drafts" }).click();
  const list = page.getByRole("dialog").filter({ hasText: "Drafts" });
  await expect(list.getByText("Rehearsal crew")).toBeVisible();
  await list.getByRole("button", { name: "Open Rehearsal crew" }).click();

  // Reopened, the draft's roster is back on the card and Save Changes is live:
  // the calendar still has the empty set, so the restored seats ARE the diff.
  const reopened = page
    .getByRole("dialog")
    .filter({ hasText: "Schedule preview" });
  const restored = reopened
    .getByTestId("staged-set-card")
    .filter({ hasText: "Private Rehearsal" })
    .first();
  await restored.scrollIntoViewIfNeeded();
  expect(await restored.getByText("None", { exact: true }).count()).toBeLessThan(
    openBefore
  );
  await expect(
    reopened.getByRole("button", { name: "Save Changes" })
  ).toBeEnabled();

  // Leave without saving, then clear the draft up after ourselves.
  await reopened.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .getByRole("button", { name: "Discard", exact: true })
    .click();

  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Set types to show" })
    .getByRole("button", { name: "Drafts" })
    .click();
  const cleanup = page.getByRole("dialog").filter({ hasText: "Drafts" });
  await cleanup.getByRole("button", { name: "Delete Rehearsal crew" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Delete this draft?" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect(cleanup.getByText("Rehearsal crew")).toHaveCount(0);
});
