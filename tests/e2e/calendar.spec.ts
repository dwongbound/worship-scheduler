// E2E: calendar tab — set list, team modal, stats windows, .ics export,
// and the admin inline "+" create / set delete flows.
import { Page, expect, test } from "@playwright/test";
import { login } from "./helpers";

// Open the "New set" form via the calendar's hover "+" button. Uses the last
// in-month day cell (always present, avoids month-boundary date math) and
// reveals its hidden "+" by hovering the containing cell first. Returns the
// open dialog with the label pre-filled.
async function openNewSetForm(page: Page, label: string) {
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: "New set" })).toBeVisible();
  await modal.getByLabel("Label").fill(label);
  return modal;
}

// Create an empty ad-hoc set (the plain "Create set" path).
async function createAdHocSet(page: Page, label: string) {
  const modal = await openNewSetForm(page, label);
  await modal.getByRole("button", { name: "Create set" }).click();
  await expect(modal).not.toBeVisible();
}

test("shows upcoming sets and opens the team modal", async ({ page }) => {
  await login(page, "bob");

  const sundayCard = page.getByText("Sunday Morning").first();
  await expect(sundayCard).toBeVisible();
  await sundayCard.click();

  // Modal lists the roster with roles and teammates.
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Bob Baker")).toBeVisible(); // drums (bob)
  await expect(modal.getByText("Carol Chen")).toBeVisible(); // keys
  await expect(modal.getByText("Worship Leader")).toBeVisible();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
});

test("'See my sets' opens a sidebar listing the sets I'm on", async ({ page }) => {
  await login(page, "bob");
  await page.getByRole("button", { name: "See my sets" }).click();

  // The sidebar lists bob's seeded "Sunday Morning" set.
  const panel = page.locator("aside").filter({ hasText: "My sets" });
  await expect(panel.getByText("Sunday Morning")).toBeVisible();
});

test("non-admins get no inline '+' create button", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("button", { name: /^Add set on/ })).toHaveCount(0);
});

test("admin creates an ad-hoc set inline from a day cell", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Special Prayer Night");

  // The new set now shows as a chip on the calendar.
  await expect(page.getByText("Special Prayer Night")).toBeVisible();
});

test("admin deletes a set from the detail modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "To Be Deleted");

  // Open the set's team modal and delete it (two-step confirm).
  await page.getByText("To Be Deleted").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Delete set" }).click();
  await modal.getByRole("button", { name: "Confirm delete" }).click();

  // Modal closes and the chip is gone.
  await expect(modal).not.toBeVisible();
  await expect(page.getByText("To Be Deleted")).toHaveCount(0);
});

test("admin assigns and removes a player in the set modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Roster Test");

  // Open the (empty) set's team modal.
  await page.getByText("Roster Test").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  // Assign a worship leader to the open slot (any change starts as PENDING).
  const wlRow = modal
    .getByRole("listitem")
    .filter({ hasText: "Worship Leader" });
  await wlRow.getByRole("combobox").first().selectOption({ label: "Jack Jones" });
  await expect(wlRow.getByText("Pending confirmation")).toBeVisible();

  // Remove them again by picking "None".
  await wlRow.getByRole("combobox").first().selectOption({ label: "None" });
  await expect(wlRow.getByText("Pending confirmation")).not.toBeVisible();
});

test("exports the current user's sets as an .ics file", async ({ page }) => {
  await login(page, "bob");
  // page.request shares the browser's session cookies.
  const response = await page.request.get("/api/export");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/calendar");

  const body = await response.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  // One event per set, titled "<set> (<my role>)" — bob drums his Sunday set.
  expect(body).toContain("SUMMARY:Sunday Morning (Drums)");
});

test("exports a single set as .ics with my role in the title", async ({ page }) => {
  await login(page, "bob");
  // Find bob's seeded Sunday Morning set id via the API.
  const sets = await (await page.request.get("/api/sets")).json();
  const sunday = sets.find(
    (s: { label: string; assignments: { user: { name: string } }[] }) =>
      s.label === "Sunday Morning" &&
      s.assignments.some((a) => a.user.name === "Bob Baker")
  );
  expect(sunday).toBeTruthy();

  const res = await page.request.get(`/api/export/${sunday.id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1); // just this set
  expect(body).toContain("SUMMARY:Sunday Morning (Drums)");
});

test("filters the calendar by my sets and by status", async ({ page }) => {
  await login(page, "admin");
  // An empty set (no team) that admin is NOT assigned to.
  await createAdHocSet(page, "Filter Fixture");
  await expect(page.getByText("Filter Fixture")).toBeVisible();

  // "My sets": admin isn't on it → hidden. Toggling off shows it again.
  await page.getByRole("button", { name: "My sets", exact: true }).click();
  await expect(page.getByText("Filter Fixture")).toHaveCount(0);
  await page.getByRole("button", { name: "My sets", exact: true }).click();
  await expect(page.getByText("Filter Fixture")).toBeVisible();

  // Status "Unconfirmed": an empty set has no pending assignment → hidden.
  await page.getByRole("button", { name: "Unconfirmed", exact: true }).click();
  await expect(page.getByText("Filter Fixture")).toHaveCount(0);
});

test("admin auto-schedules a custom set, reviews, then applies", async ({ page }) => {
  await login(page, "admin");

  // "Auto schedule" from the New set form proposes a team WITHOUT saving.
  const form = await openNewSetForm(page, "Auto Night");
  await form.getByRole("button", { name: "Auto schedule" }).click();

  // The review modal opens with the proposal; the set isn't on the calendar
  // yet (nothing has been persisted).
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await expect(review.getByText("Auto Night")).toBeVisible();
  // The scheduler filled at least one slot (seed has plenty of free players).
  await expect(
    review.getByText(/Staged 1 set with [1-9]\d* assignments?/)
  ).toBeVisible();

  // Apply commits the set and its tentative (PENDING) team.
  await review.getByRole("button", { name: "Apply schedule" }).click();
  await expect(review).not.toBeVisible();

  // The set now shows on the calendar and opens with a pending team.
  await page.getByText("Auto Night").click();
  const detail = page.getByRole("dialog");
  await expect(detail.getByText("Pending confirmation").first()).toBeVisible();
});

test("discarding an auto-scheduled proposal saves nothing", async ({ page }) => {
  await login(page, "admin");

  const form = await openNewSetForm(page, "Discarded Night");
  await form.getByRole("button", { name: "Auto schedule" }).click();

  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await review.getByRole("button", { name: "Discard" }).click();
  await expect(review).not.toBeVisible();

  // Nothing was persisted — no chip for the discarded set.
  await expect(page.getByText("Discarded Night")).toHaveCount(0);
});
