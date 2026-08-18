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

// Assert a set's calendar chip is visible, paging the month view to the month
// the set actually falls in (the calendar opens on the current month, and a
// seeded set on "next <weekday>" can land in the following one). Scope to the
// visible grid chip (the hidden mobile panel repeats the label).
async function expectChipVisible(
  page: import("@playwright/test").Page,
  label: string
) {
  // Read the set from the API first. That both confirms it's in the user's
  // data (after a join the calendar refetches async) and tells us its month,
  // so we page straight there instead of guessing — probing the rendered grid
  // to decide whether to advance raced the refetch and paged past the set.
  let startsAt = "";
  await expect(async () => {
    const sets = (await (await page.request.get("/api/sets")).json()) as {
      label: string | null;
      startsAt: string;
    }[];
    const match = sets.find((s) => s.label === label);
    expect(match, `no set labelled "${label}"`).toBeTruthy();
    startsAt = match!.startsAt;
  }).toPass();

  const now = new Date();
  const target = new Date(startsAt);
  const months =
    (target.getFullYear() - now.getFullYear()) * 12 +
    (target.getMonth() - now.getMonth());
  const step = page.getByRole("button", {
    name: months < 0 ? "Previous month" : "Next month",
  });
  for (let i = 0; i < Math.abs(months); i++) await step.click();

  // Full timeout here absorbs the grid's own refetch after a join.
  await expect(
    page.getByText(label).filter({ visible: true }).first()
  ).toBeVisible();
}

test("calendar defaults to All orgs, filters per org, and persists the choice", async ({
  page,
}) => {
  await login(page, "paul");

  // Default view: everything from both orgs, switcher reads "All orgs".
  await expect(page.getByTestId("org-switcher")).toContainText("All orgs");
  await expectChipVisible(page, "College Night");

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
  // exact:true — each member card has an sr-only "Team for <name>" select label
  // that a substring match would also catch.
  await expect(page.getByText("Bob Baker", { exact: true })).toBeVisible();

  // Switch the admin org to org 2: only its four members remain, only its
  // team exists, and nothing hints at org 1.
  await pickOrg(page, orgName(1));
  await expect(page.getByText("Grace Gao", { exact: true })).toBeVisible();
  await expect(page.getByText("Bob Baker", { exact: true })).toHaveCount(0);
  // The Teams card lists this org's team as a button (name + member count).
  // (getByText would also match the hidden <option> in the team filter select.)
  await expect(
    page.getByRole("button", { name: /College Team\s*\d+ member/ })
  ).toBeVisible();
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
  await expectChipVisible(page, "College Night");
  // And the switcher menu now lists the new org.
  await page.getByTestId("org-switcher").click();
  await expect(
    page.getByRole("button", { name: orgName(1), exact: true })
  ).toBeVisible();
});
