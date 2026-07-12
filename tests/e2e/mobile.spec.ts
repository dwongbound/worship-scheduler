// E2E: narrow / phone-width behavior. The app swaps to a mobile layout below
// the `sm`/`md` breakpoints — a floating bottom tab bar replaces the top strip,
// the calendar tab shows a "My sets" list instead of the dense month grid, and
// desktop-only affordances (the .ics export) drop away. A narrow viewport is
// enough to exercise all of this (the responsive CSS keys off width).
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// iPhone-ish portrait viewport — below the sm (640px) and md (768px) breakpoints.
test.use({ viewport: { width: 390, height: 844 } });

test("phone shows the bottom tab bar and navigates with it", async ({ page }) => {
  await login(page, "bob");

  // The desktop tab strip is display:none on phones (getByRole ignores hidden),
  // so its full "Set Manager" label isn't reachable...
  await expect(page.getByRole("link", { name: "Set Manager" })).toHaveCount(0);
  // ...while the bottom bar's short "Sets" label is, and it navigates.
  const setsTab = page.getByRole("link", { name: "Sets", exact: true });
  await expect(setsTab).toBeVisible();
  await setsTab.click();

  await expect(page).toHaveURL(/\/swaps/);
  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
});

test("phone calendar shows the My sets list, not the month grid", async ({ page }) => {
  await login(page, "bob");

  // The desktop month grid is hidden — its month-nav "Today" button isn't shown.
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);

  // Instead, the mobile "My sets" list is shown; tapping a set opens its roster.
  const setCard = page.getByText("Sunday Morning").filter({ visible: true }).first();
  await expect(setCard).toBeVisible();
  await setCard.click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Worship Leader")).toBeVisible();
});

test("phone Set Manager hides the desktop-only .ics export", async ({ page }) => {
  await login(page, "bob");
  await page.goto("/swaps");

  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
  // The export button is desktop-only (hidden sm:block) — present but not shown.
  await expect(page.getByText("Export my sets (.ics)")).toBeHidden();
});
