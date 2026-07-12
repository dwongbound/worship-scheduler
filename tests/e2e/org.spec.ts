// E2E: multi-org behavior — the navbar switcher's view filter (+ localStorage
// persistence), the org chip in the set detail modal, and the Team tab's
// strict single-org scoping. Seed facts used here: paul belongs to BOTH orgs
// (admin of both); org 2 ("Youth Ministry" in test env) holds the College
// Team + the "College Night" set with paul/grace/jack/ruth as its members;
// bob belongs only to org 1.
import { expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

// Org names come from env/test.env's ORG_KEYS ("Name:key,Name:key").
function orgName(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  const name = entry.slice(0, entry.lastIndexOf(":")).trim();
  expect(name, `no ORG_KEYS entry at index ${index}`).toBeTruthy();
  return name;
}

async function pickOrg(page: import("@playwright/test").Page, label: string) {
  await page.getByTestId("org-switcher").click();
  await page.getByRole("button", { name: label, exact: true }).click();
}

test("calendar defaults to All orgs, filters per org, and persists the choice", async ({
  page,
}) => {
  await login(page, "paul");

  // Default view: everything from both orgs, switcher reads "All orgs".
  await expect(page.getByTestId("org-switcher")).toContainText("All orgs");
  await expect(page.getByText("College Night").first()).toBeVisible();

  // The set detail modal names the set's org with a chip.
  const modal = await openSetByLabel(page, "College Night");
  await expect(modal.getByText(orgName(1))).toBeVisible();
  await page.keyboard.press("Escape");

  // Filter to org 1 → org 2's set disappears from the calendar.
  await pickOrg(page, orgName(0));
  await expect(page.getByText("College Night")).toHaveCount(0);

  // The selection is stored in localStorage — it survives a reload.
  await page.reload();
  await expect(page.getByTestId("org-switcher")).toContainText(orgName(0));
  await expect(page.getByText("College Night")).toHaveCount(0);
});

test("Team tab scopes members and teams to one org with no cross-org leakage", async ({
  page,
}) => {
  await login(page, "paul");
  await page.goto("/users");

  // Default admin org = the oldest one paul administers (org 1): the whole
  // congregation is listed.
  await expect(page.getByText("Bob Baker")).toBeVisible();

  // Switch the admin org to org 2: only its four members remain, only its
  // team exists, and nothing hints at org 1.
  await pickOrg(page, orgName(1));
  await expect(page.getByText("Grace Gao")).toBeVisible();
  await expect(page.getByText("Bob Baker")).toHaveCount(0);
  await expect(page.getByText("College Team").first()).toBeVisible();
  await expect(page.getByText("Sunday Team")).toHaveCount(0);
});

test("a member can join another org by key from the navbar", async ({
  page,
}) => {
  // bob belongs only to org 1.
  await login(page, "bob");
  await expect(page.getByText("College Night")).toHaveCount(0);

  // Navbar switcher → "+ Add an org…" → enter org 2's key.
  await page.getByTestId("org-switcher").click();
  await page.getByRole("button", { name: "+ Add an org…" }).click();
  const entry = (process.env.ORG_KEYS ?? "").split(",")[1] ?? "";
  await page
    .getByLabel("Organization key")
    .fill(entry.slice(entry.lastIndexOf(":") + 1).trim());
  await page.getByRole("button", { name: "Join", exact: true }).click();

  // Org 2's sets now show up in the (still "All orgs") calendar view.
  await expect(page.getByText("College Night").first()).toBeVisible();
  // And the switcher menu now lists the new org.
  await page.getByTestId("org-switcher").click();
  await expect(
    page.getByRole("button", { name: orgName(1), exact: true })
  ).toBeVisible();
});
