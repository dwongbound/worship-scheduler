// E2E: Org settings → Scheduling rules — the built-in behaviour every org now
// starts with (an MD order and the acoustic doubling as a rule), and a rule
// scoped to one team. Seed facts: paul administers org 1, whose teams are
// "Sunday Team" and "Prayer Room Team". The test removes the rule it adds, so
// the org's list is back to the seeded defaults afterwards.
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

function orgName(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  const name = entry.slice(0, entry.lastIndexOf(":")).trim();
  expect(name, `no ORG_KEYS entry at index ${index}`).toBeTruthy();
  return name;
}

async function openRules(page: Page) {
  await login(page, "paul");
  await page.goto("/orgs");
  await page.getByRole("button", { name: orgName(0) }).click();
  await expect(page.getByText("Scheduling rules")).toBeVisible();
}

test("every org starts with the MD order and the acoustic doubling as rules", async ({ page }) => {
  await openRules(page);
  await expect(page.getByText("Musical directors lead from Electric Guitar, Keys then Bass")).toBeVisible();
  await expect(
    page.getByText("Whoever plays Worship Leader or Vox may also play Acoustic Guitar")
  ).toBeVisible();
});

test("a team gets its own MD order, and can't have two", async ({ page }) => {
  await openRules(page);

  await page.getByRole("button", { name: "+ Add rule" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /MD order/ }).click();
  await dialog.getByLabel("Applies to").selectOption({ label: "Sunday Team only" });
  await dialog.getByLabel("MD role 1").selectOption({ label: "Keys" });
  await dialog.getByRole("button", { name: "+ role" }).click();
  await dialog.getByLabel("MD role 2").selectOption({ label: "Bass" });
  // An MD order is always required — the preference card is off.
  await expect(dialog.getByRole("radio", { name: /Preference/ })).toBeDisabled();
  await expect(dialog.getByText("Replaces the every-team MD order")).toBeVisible();
  await dialog.getByRole("button", { name: "Add rule" }).click();
  await expect(dialog).toBeHidden();

  // The row names its team, and it survives a reload.
  const row = page.getByRole("listitem").filter({ hasText: "Musical directors lead from Keys then Bass" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Sunday Team")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: orgName(0) }).click();
  await expect(row).toBeVisible();

  // A second order for the same team is refused before it's saved.
  await page.getByRole("button", { name: "+ Add rule" }).click();
  await dialog.getByRole("button", { name: /MD order/ }).click();
  await dialog.getByLabel("Applies to").selectOption({ label: "Sunday Team only" });
  await dialog.getByLabel("MD role 1").selectOption({ label: "Electric Guitar" });
  await expect(dialog.getByText("This team already has an MD order.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Add rule" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Clean up: back to the seeded defaults. The delete is optimistic, so wait
  // for its save before checking it stuck.
  const saved = page.waitForResponse((r) => r.url().includes("/rules") && r.request().method() === "PUT");
  await row.getByRole("button", { name: /^Delete:/ }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: orgName(0) }).click();
  await expect(page.getByText("Musical directors lead from Electric Guitar, Keys then Bass")).toBeVisible();
  await expect(row).toBeHidden();
});
