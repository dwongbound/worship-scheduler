// E2E: private ad-hoc sets. A private set is visible only to org admins and the
// people assigned to it; everyone else never sees it (no calendar chip, absent
// from /api/sets, and its .ics export 404s). Admins set privacy when creating a
// set from the calendar, and can toggle it later from the set detail modal.
import { Page, expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

// The set labels the API returns (just what these tests read).
type ApiSetLite = { id: string; label: string | null; isPrivate: boolean };

async function fetchSets(page: Page): Promise<ApiSetLite[]> {
  return (await (await page.request.get("/api/sets")).json()) as ApiSetLite[];
}

// Open the calendar's inline "New set" form on the last in-month day cell.
async function openNewSetForm(page: Page, label: string) {
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();
  const modal = page.getByRole("dialog");
  // The set's name IS the modal heading — an editable field, not an <h2>.
  await expect(modal.getByLabel("Set name")).toBeVisible();
  await modal.getByLabel("Set name").fill(label);
  return modal;
}

test("private set is hidden from a user who isn't on it or an admin", async ({
  page,
}) => {
  // As an admin, capture the seeded private set's id (admins can see it).
  await login(page, "admin");
  const priv = (await fetchSets(page)).find(
    (s) => s.label === "Private Rehearsal"
  );
  expect(priv, "admin can see the private set").toBeTruthy();
  expect(priv!.isPrivate).toBe(true);

  // kate is neither assigned nor an admin → the set doesn't exist for her.
  await login(page, "kate");
  const asKate = await fetchSets(page);
  expect(asKate.find((s) => s.label === "Private Rehearsal")).toBeFalsy();
  await expect(page.getByText("Private Rehearsal")).toHaveCount(0);

  // Even the direct .ics export is masked as not-found.
  const res = await page.request.get(`/api/export/${priv!.id}`);
  expect(res.status()).toBe(404);
});

test("an assigned user can see the private set", async ({ page }) => {
  // bob is assigned (drums) to the seeded "Private Rehearsal".
  await login(page, "bob");
  expect(
    (await fetchSets(page)).find((s) => s.label === "Private Rehearsal")
  ).toBeTruthy();

  // And can open its roster modal (deep-link is reliable in a crowded grid).
  // The private lock badge on the title carries title/aria-label "Private"
  // (its visible text is just the 🔒 glyph).
  const modal = await openSetByLabel(page, "Private Rehearsal");
  await expect(modal.getByTitle("Private")).toBeVisible();
});

test("admin creates a private set from the calendar, then toggles it public", async ({
  page,
}) => {
  await login(page, "admin");

  // Create an ad-hoc set with the "Private" box checked.
  const modal = await openNewSetForm(page, "Secret Set");
  await modal.getByLabel(/^Private/).check();
  await modal.getByRole("button", { name: "Create set" }).click();
  await expect(modal).not.toBeVisible();

  // It saved private, and admin sees it.
  await expect(async () => {
    const created = (await fetchSets(page)).find((s) => s.label === "Secret Set");
    expect(created?.isPrivate).toBe(true);
  }).toPass();

  // A non-admin who isn't on it can't see it.
  await login(page, "bob");
  expect(
    (await fetchSets(page)).find((s) => s.label === "Secret Set")
  ).toBeFalsy();

  // Admin toggles it public from the detail modal's overflow (⋮) menu, where
  // the "Private" toggle now lives. The menu's panel is portalled to <body>
  // (components/common/Dropdown.tsx), so the item is looked up on the page;
  // the title's lock badge is a span, so the name doesn't collide.
  await login(page, "admin");
  const detail = await openSetByLabel(page, "Secret Set");
  await detail.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await expect(async () => {
    const nowPublic = (await fetchSets(page)).find((s) => s.label === "Secret Set");
    expect(nowPublic?.isPrivate).toBe(false);
  }).toPass();

  // Now bob (a plain org member) can see it.
  await login(page, "bob");
  await expect(async () => {
    expect(
      (await fetchSets(page)).find((s) => s.label === "Secret Set")
    ).toBeTruthy();
  }).toPass();
});
