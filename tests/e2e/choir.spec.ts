// E2E: the Choir role. Unlike the band roles, choir has no fixed slot count —
// it's an unbounded, admin-managed list. "Auto schedule" seats every available
// choir member, and admins can also add people by hand from the same dropdown.
import { expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

// Create an empty set from the calendar's inline "New set" form on the last
// in-month day cell, and return its detail modal. A distinctive label + time
// keeps each test's ad-hoc set from colliding with the others there.
async function createEmptySet(page: import("@playwright/test").Page, label: string, time: string) {
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();

  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "New set" })).toBeVisible();
  await form.getByLabel("Label").fill(label);
  await form.getByLabel("Start time").fill(time);
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  return openSetByLabel(page, label);
}

test("admin manually adds a person to the choir", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Manual", "14:11");

  // The Choir section starts empty with a single "None" add dropdown. Carol
  // lists CHOIR as a skill (seed) and has no unavailability, so she's offered.
  const choir = modal.getByTestId("choir-section");
  await expect(choir.getByText("Choir", { exact: true })).toBeVisible();

  await choir.getByRole("button", { name: "None" }).click();
  await choir.getByPlaceholder("Search by name…").fill("Carol");
  await choir.getByRole("button", { name: "Carol Chen" }).click();

  // She now sits in the choir as PENDING (she still confirms).
  await expect(choir.getByText("Carol Chen")).toBeVisible();
  await expect(choir.getByText("Pending confirmation")).toBeVisible();
});

test("auto schedule seats every available choir member", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Auto", "14:22");

  const choir = modal.getByTestId("choir-section");
  // Empty to start — no seeded choir member is in it yet.
  await expect(choir.getByText("Carol Chen")).toHaveCount(0);

  await modal.getByRole("button", { name: "Auto schedule" }).click();

  // Carol has no unavailability, so auto-schedule always seats her on the choir
  // (grace/quinn join too whenever they're free at the set's time).
  await expect(choir.getByText("Carol Chen")).toBeVisible();
});
