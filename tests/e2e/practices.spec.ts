// E2E: practices on a set. A practice is an extra calendar event for the
// people already on a set, so what's worth checking in a browser is that it's
// reachable from the set (and ONLY from the set, never the calendar), that the
// free/busy read happens on the click rather than on open, that a member can
// read but not change it, and that a weekly set time can hand one down.
import { Page, expect, test } from "@playwright/test";
import { login, openSetByLabel, seedOwnSetTime } from "./helpers";

const SET = "Sunday Morning";

/**
 * Put a practice on a set through the API, so each test starts from the state
 * it needs rather than from whatever the test before it left. Returns the
 * practice.
 */
async function givePractice(page: Page, label: string) {
  const sets = (await (await page.request.get("/api/sets")).json()) as {
    id: string;
    label: string | null;
    practices?: { id: string }[];
  }[];
  const set = sets.find((s) => s.label === label);
  expect(set, `no set labelled "${label}"`).toBeTruthy();

  // Idempotent-ish: one practice is all any of these tests needs, and a second
  // would make the row locators ambiguous.
  if (set!.practices?.length) return { setId: set!.id };

  // Tomorrow evening, so it's never already past (a past practice is skipped
  // by the calendar sync and would read as a different case here).
  const day = new Date();
  day.setDate(day.getDate() + 1);
  const at = (hour: number) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).toISOString();
  const res = await page.request.post(`/api/sets/${set!.id}/practices`, {
    data: { startsAt: at(19), endsAt: at(21) },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return { setId: set!.id };
}

test("an admin adds a practice to a set, and it isn't on the calendar", async ({
  page,
}) => {
  await login(page, "admin");
  const modal = await openSetByLabel(page, SET);

  await expect(modal.getByText("Practices", { exact: true })).toBeVisible();

  await modal.getByRole("button", { name: "+ Add Practice" }).click();
  // The form opens on a sensible evening window, so adding one is two clicks.
  await expect(modal.getByTestId("practice-from")).toHaveValue("19:00");
  await expect(modal.getByTestId("practice-to")).toHaveValue("21:00");
  // It says what pressing the button does before you press it.
  await expect(modal.getByText(/calendar invite as soon as you add it/)).toBeVisible();

  await modal.getByRole("button", { name: "Add practice", exact: true }).click();
  await expect(modal.getByRole("button", { name: /Who’s free\?/ }).first()).toBeVisible();

  // Not on the calendar — the set's own modal is a practice's one home.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText(/Who’s free\?/)).toHaveCount(0);
});

test("who's free is read when the practice is clicked, not when the set opens", async ({
  page,
}) => {
  await login(page, "admin");
  await givePractice(page, SET);

  // Count the availability reads, so "lazy" is measured rather than assumed.
  let reads = 0;
  await page.route("**/availability", async (route) => {
    reads++;
    await route.continue();
  });

  const modal = await openSetByLabel(page, SET);
  const row = modal.getByRole("button", { name: /Who’s free\?/ }).first();
  await expect(row).toBeVisible();
  // The set is open and the practice is on screen — and nothing has been asked.
  expect(reads).toBe(0);

  await row.click();
  const freeBusy = page.getByRole("dialog").last();
  await expect(freeBusy.getByText(/of \d+ free/)).toBeVisible();
  expect(reads).toBe(1);
});

test("a member can read a set's practices but not change them", async ({ page }) => {
  // Carol is on the Sunday team, not an admin: when the team rehearses is hers
  // to read, not to edit.
  await login(page, "admin");
  await givePractice(page, SET);
  await login(page, "carol");

  const modal = await openSetByLabel(page, SET);
  await expect(modal.getByRole("button", { name: /Who’s free\?/ }).first()).toBeVisible();
  await expect(modal.getByRole("button", { name: "+ Add Practice" })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: "Delete practice" })).toHaveCount(0);
});

test("deleting a practice asks first, because it emails everyone", async ({ page }) => {
  await login(page, "admin");
  await givePractice(page, SET);
  const modal = await openSetByLabel(page, SET);

  await modal.getByRole("button", { name: "Delete practice" }).first().click();
  const confirm = page.getByRole("dialog").last();
  await expect(confirm.getByText(/cancellation from Google Calendar/)).toBeVisible();
  // Dismissing leaves it alone — the ask is a real gate, not a formality.
  // `exact` — the header's own ✕ is labelled "Close dialog", which a substring
  // match would also claim.
  await confirm.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal.getByRole("button", { name: /Who’s free\?/ }).first()).toBeVisible();

  await modal.getByRole("button", { name: "Delete practice" }).first().click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Delete practice" })
    .click();
  await expect(modal.getByRole("button", { name: /Who’s free\?/ })).toHaveCount(0);
});

test("the practice rows read left to right: ✕, then the row it removes", async ({
  page,
}) => {
  await login(page, "admin");
  await givePractice(page, SET);
  const modal = await openSetByLabel(page, SET);

  // The ✕ LEADS its row. Trailing it, it sat under whichever field wrapped
  // last on a phone and stopped reading as "remove THIS one".
  const remove = modal.getByRole("button", { name: "Delete practice" }).first();
  const row = modal.getByRole("button", { name: /Who’s free\?/ }).first();
  const removeBox = (await remove.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(removeBox.x + removeBox.width).toBeLessThanOrEqual(rowBox.x + 1);
  // Still a real touch target.
  expect(removeBox.height).toBeGreaterThanOrEqual(44);

  // Adding is the full-width dashed bar, the same control the Create tab's
  // weekly set times use — so it spans the list it adds to, not a chip's worth.
  const add = modal.getByRole("button", { name: "+ Add Practice" });
  const addBox = (await add.boundingBox())!;
  expect(addBox.width).toBeGreaterThan(
    removeBox.width + rowBox.width - 2
  );
});

test("a weekly set time carries practices, and the list says how many", async ({
  page,
}) => {
  await login(page, "admin");
  // Its own weekly time, at a slot no other spec uses, so adding a practice to
  // it can't change what another spec's generate finds.
  const label = "Practices Weekly";
  await seedOwnSetTime(page, { label, dayOfWeek: 2, startMinute: 6 * 60 + 15 });
  await page.goto("/create");

  const row = page.locator("tr").filter({ hasText: label });
  await expect(row).toBeVisible();
  // No practices yet, so the time reads as the bare time it always has.
  await expect(row.getByTitle(/Wednesdays/)).toHaveCount(0);

  await row.getByRole("button", { name: "Edit" }).click();
  const form = page.getByRole("dialog");
  await expect(form.getByText("Practices", { exact: true })).toBeVisible();
  await form.getByRole("button", { name: "+ Add Practice" }).click();
  // Defaults to the midweek evening most teams rehearse on.
  await expect(form.getByTestId("template-practice-day")).toHaveValue("3");

  // An end time that hasn't caught up with the start is refused in words,
  // rather than offering a save the server would reject.
  await form.getByTestId("template-practice-end").fill("18:00");
  await expect(form.getByText("A practice has to end after it starts.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Save changes" })).toBeDisabled();

  await form.getByTestId("template-practice-end").fill("21:00");
  await form.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // "+1" after the time, and hovering it says which day.
  const badge = page.locator("tr").filter({ hasText: label }).getByTitle(/Wednesdays/);
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText("+1");
});
