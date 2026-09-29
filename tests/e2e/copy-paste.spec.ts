// E2E: copying one staged set's shape + roster onto another, and taking the
// paste back.
//
// Driven from the calendar's Preview Mode rather than a generated plan: both
// are the same editor over the same cards, and the seed gives Preview Mode two
// sets on ONE team with known, different rosters — "Sunday Morning" (a full
// crew, Carol Chen on keys) and "Private Rehearsal" (only Bob on drums). Carol
// is therefore the tell: she can only appear on the rehearsal by being pasted
// there, and can only leave again by being undone.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Open Preview Mode over the real calendar and return the review dialog.
async function openPreview(page: import("@playwright/test").Page) {
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Preview Mode" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "See preview" }).click();
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Schedule preview" })
  ).toBeVisible();
  return review;
}

test("copy a set's roles and people onto another set, then undo it", async ({
  page,
}) => {
  await login(page, "admin");
  const review = await openPreview(page);

  // Pinned by its roster as well as its name: the seed has two Sunday Mornings
  // and only the near one carries Carol.
  const source = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Sunday Morning" })
    .filter({ hasText: "Carol Chen" })
    .first();
  const target = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Private Rehearsal" })
    .first();
  await source.scrollIntoViewIfNeeded();

  await expect(target.getByText("Carol Chen")).toHaveCount(0);

  // Clicking the card's own space selects it — the border change is exposed as
  // data-selected so the test isn't asserting on a colour.
  await source.getByText("Sunday Morning").first().click();
  await expect(source).toHaveAttribute("data-selected", "true");

  // Copy: the card says so, briefly.
  await page.keyboard.press("ControlOrMeta+c");
  await expect(source.getByText("Copied!")).toBeVisible();

  // Paste onto the other set. Selecting it releases the source.
  await target.scrollIntoViewIfNeeded();
  await target.getByText("Private Rehearsal").first().click();
  await expect(target).toHaveAttribute("data-selected", "true");
  await expect(source).not.toHaveAttribute("data-selected", "true");

  await page.keyboard.press("ControlOrMeta+v");
  await expect(target.getByText("Pasted!")).toBeVisible();
  // The source's people are on it now — the whole point of the paste.
  await expect(target.getByText("Carol Chen")).toBeVisible();
  // …and the set it was copied FROM is untouched.
  await expect(source.getByText("Carol Chen")).toBeVisible();

  // Undo puts the target back as it was. The pill is an icon, so the assertion
  // goes through the text it carries for screen readers.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(target.getByText("Paste undone")).toBeVisible();
  await expect(target.getByText("Carol Chen")).toHaveCount(0);

  // One paste, one undo — a second ⌘Z has nothing left to take back and must
  // not walk further into a history it doesn't have.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(target.getByText("Carol Chen")).toHaveCount(0);
  await expect(source.getByText("Carol Chen")).toBeVisible();
});

test("the shortcuts keep out of the way of a field you're typing in", async ({
  page,
}) => {
  await login(page, "admin");
  const review = await openPreview(page);

  const source = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Sunday Morning" })
    .filter({ hasText: "Carol Chen" })
    .first();
  await source.scrollIntoViewIfNeeded();
  await source.getByText("Sunday Morning").first().click();
  await expect(source).toHaveAttribute("data-selected", "true");

  // With the selection live but focus inside a form control, ⌘/Ctrl+C has to
  // stay the browser's own copy — otherwise the controls in a card could never
  // be used normally while a set happens to be picked.
  await review.getByRole("combobox").first().focus();
  await page.keyboard.press("ControlOrMeta+c");
  await expect(review.getByText("Copied!")).toHaveCount(0);

  // The selection itself is untouched — the key was ignored, not swallowed.
  await expect(source).toHaveAttribute("data-selected", "true");
});
