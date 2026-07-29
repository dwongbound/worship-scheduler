// E2E: the Choir role. Unlike the band roles, choir has no fixed slot count —
// it's an unbounded, admin-managed list. Choir is opt-in PER SET: an admin
// enables it on a set before anyone can be added or auto-scheduled into it.
// Once on, "Auto schedule" seats every available choir member, and admins can
// also add people by hand from the same dropdown.
import { expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

// Create an empty set from the calendar's inline "New set" form on the last
// in-month day cell, and return its detail modal. A distinctive label + time
// keeps each test's ad-hoc set from colliding with the others there. Pass
// `team` to scope the set to a specific team (defaults to the form's first).
async function createEmptySet(
  page: import("@playwright/test").Page,
  label: string,
  time: string,
  team?: string
) {
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();

  const form = page.getByRole("dialog");
  await expect(form.getByRole("heading", { name: "New set" })).toBeVisible();
  await form.getByLabel("Label").fill(label);
  await form.getByLabel("Start time").fill(time);
  if (team) await form.getByLabel("Team").selectOption({ label: team });
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  return openSetByLabel(page, label);
}

test("admin manually adds a person to the choir", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Manual", "14:11");

  // Choir is off by default — turn it on before anyone can be added. Carol
  // lists CHOIR as a skill (seed) and has no unavailability, so she's offered.
  const choir = modal.getByTestId("choir-section");
  await expect(choir.getByText("Choir", { exact: true })).toBeVisible();
  await choir.getByRole("button", { name: "Enable choir" }).click();

  await choir.getByRole("button", { name: "None" }).click();
  await choir.getByPlaceholder("Search by name…").fill("Carol");
  await choir.getByRole("button", { name: "Carol Chen" }).click();

  // She now sits in the choir as PENDING (she still confirms).
  await expect(choir.getByText("Carol Chen")).toBeVisible();
  await expect(choir.getByText("Pending confirmation")).toBeVisible();

  // The "✕" (same affordance as the band roles) removes her from the choir.
  await choir
    .getByRole("button", { name: "Remove Carol Chen from choir" })
    .click();
  await expect(choir.getByText("Carol Chen")).toHaveCount(0);
});

test("choir is org-wide: a singer off the set's team can still be added", async ({ page }) => {
  await login(page, "admin");
  // A Prayer Room Team set. Carol lists CHOIR but is only on the Sunday Team
  // (seed) — for band roles she'd be excluded, but choir isn't team-scoped, so
  // she must still be offered here.
  const modal = await createEmptySet(page, "Choir Cross Team", "15:11", "Prayer Room Team");

  const choir = modal.getByTestId("choir-section");
  await choir.getByRole("button", { name: "Enable choir" }).click();

  await choir.getByRole("button", { name: "None" }).click();
  await choir.getByPlaceholder("Search by name…").fill("Carol");
  await choir.getByRole("button", { name: "Carol Chen" }).click();

  // She's seated on this off-team set's choir as PENDING.
  await expect(choir.getByText("Carol Chen")).toBeVisible();
  await expect(choir.getByText("Pending confirmation")).toBeVisible();
});

test("auto schedule seats every available choir member once choir is on", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Auto", "14:22");

  const choir = modal.getByTestId("choir-section");
  // Empty to start — no seeded choir member is in it yet.
  await expect(choir.getByText("Carol Chen")).toHaveCount(0);

  // Enable choir so auto-schedule includes it.
  await choir.getByRole("button", { name: "Enable choir" }).click();
  await modal.getByRole("button", { name: "Auto schedule" }).click();

  // Carol has no unavailability, so auto-schedule always seats her on the choir
  // (grace/quinn join too whenever they're free at the set's time).
  await expect(choir.getByText("Carol Chen")).toBeVisible();
});

test("auto schedule skips choir while it's off", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Off", "14:33");

  const choir = modal.getByTestId("choir-section");
  // Left off: the enable button is showing and no add dropdown is present.
  await expect(choir.getByRole("button", { name: "Enable choir" })).toBeVisible();

  await modal.getByRole("button", { name: "Auto schedule" }).click();

  // The band fills, but no choir singer is seated while choir is off — Carol
  // (a choir member with no band role on this team) is never added.
  await expect(choir.getByRole("button", { name: "Enable choir" })).toBeVisible();
  await expect(choir.getByText("Carol Chen")).toHaveCount(0);
});
