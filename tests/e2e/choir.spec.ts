// E2E: the Choir role. Unlike the band roles, choir has no fixed slot count —
// it's an unbounded, admin-managed list. Choir is opt-in PER SET: an admin
// enables it under the (⋮) menu's "Change Roles", alongside the rest of the
// set's shape, before anyone can be added or auto-scheduled into it. A set
// with choir off has no choir section at all. Once on, "Auto schedule" seats
// every available choir member, and admins can also add people by hand.
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
  // The set's name IS the modal heading — an editable field, not an <h2>.
  await expect(form.getByLabel("Set name")).toBeVisible();
  await form.getByLabel("Set name").fill(label);
  await form.getByLabel("Start time").fill(time);
  if (team) await form.getByLabel("Team").selectOption({ label: team });
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  return openSetByLabel(page, label);
}

// Turn choir on for the open set, via (⋮) → "Change Roles". The (⋮) panel is
// portalled to <body> (components/common/Dropdown.tsx), so its items are looked
// up on the page rather than inside the dialog. Returns the choir section,
// which only exists once choir is on.
async function enableChoir(
  page: import("@playwright/test").Page,
  modal: ReturnType<import("@playwright/test").Page["getByRole"]>
) {
  await modal.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Change Roles", exact: true }).click();
  const roles = page.getByRole("dialog").last();
  await roles.getByLabel("Include choir in set").check();
  await roles.getByRole("button", { name: "Save" }).click();

  const choir = modal.getByTestId("choir-section");
  await expect(choir).toBeVisible();
  return choir;
}

test("admin manually adds a person to the choir", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Manual", "14:11");

  // Choir is off by default — turn it on before anyone can be added. Carol
  // lists CHOIR as a skill (seed) and has no unavailability, so she's offered.
  const choir = await enableChoir(page, modal);
  await expect(choir.getByText("Choir", { exact: true })).toBeVisible();

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

test("choir is team-scoped: a singer off the set's team is not offered", async ({ page }) => {
  await login(page, "admin");
  // A Prayer Room Team set. Carol lists CHOIR but only on the Sunday Team
  // (seed), so — now that choir is a per-team role — she is NOT offered here.
  // Grace, who's on the Prayer Room Team with CHOIR, is.
  const modal = await createEmptySet(page, "Choir Cross Team", "15:11", "Prayer Room Team");

  const choir = await enableChoir(page, modal);
  await choir.getByRole("button", { name: "None" }).click();

  // Carol (Sunday-only) doesn't appear in this team's choir picker.
  await choir.getByPlaceholder("Search by name…").fill("Carol");
  await expect(choir.getByRole("button", { name: "Carol Chen" })).toHaveCount(0);

  // Grace (on the Prayer Room Team, with CHOIR) does, and can be seated.
  await choir.getByPlaceholder("Search by name…").fill("Grace");
  await choir.getByRole("button", { name: "Grace Gao" }).click();
  await expect(choir.getByText("Grace Gao")).toBeVisible();
  await expect(choir.getByText("Pending confirmation")).toBeVisible();
});

test("auto schedule seats every available choir member once choir is on", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Auto", "14:22");

  // Enable choir so auto-schedule includes it; it starts empty.
  const choir = await enableChoir(page, modal);
  await expect(choir.getByText("Carol Chen")).toHaveCount(0);

  await modal.getByRole("button", { name: "Auto schedule" }).click();

  // Carol has no unavailability, so auto-schedule always seats her on the choir
  // (grace/quinn join too whenever they're free at the set's time).
  await expect(choir.getByText("Carol Chen")).toBeVisible();
});

test("auto schedule skips choir while it's off", async ({ page }) => {
  await login(page, "admin");
  const modal = await createEmptySet(page, "Choir Off", "14:33");

  // Left off: there's no choir section on the set at all.
  const choir = modal.getByTestId("choir-section");
  await expect(choir).toHaveCount(0);

  await modal.getByRole("button", { name: "Auto schedule" }).click();

  // The band fills, but no choir singer is seated while choir is off — Carol
  // (a choir member with no band role on this team) is never added, and the
  // section still isn't there.
  await expect(choir).toHaveCount(0);
  await expect(modal.getByText("Carol Chen")).toHaveCount(0);
});
