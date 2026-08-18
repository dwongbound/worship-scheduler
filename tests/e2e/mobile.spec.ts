// E2E: phone behavior. The app swaps to a mobile layout below the `sm`/`md`/`lg`
// breakpoints — a floating bottom tab bar replaces the top strip, the calendar
// tab shows a "My sets" list instead of the dense month grid, the Availabilities
// calendar drops away, and desktop-only affordances (the .ics export) hide.
//
// This file backs the "mobile-ios" and "mobile-android" playwright projects
// (see playwright.config.ts): it runs under real device presets — iPhone 16 Pro
// and Galaxy S24 — for their mobile UA, touch, and DPR, and the desktop project
// skips it. So don't set a viewport here; each project's device owns it.
import { expect, test } from "@playwright/test";
import {
  login,
  pickSingleDay,
  requestAvailability,
  sectionByHeading,
} from "./helpers";

test("phone shows the bottom tab bar and navigates with it", async ({ page }) => {
  await login(page, "bob");

  // The desktop tab strip is display:none on phones (getByRole ignores hidden),
  // so its full "Set Manager" label isn't reachable...
  await expect(page.getByRole("link", { name: "Set Manager" })).toHaveCount(0);
  // ...while the bottom bar's short "My Sets" label is, and it navigates.
  const setsTab = page.getByRole("link", { name: "My Sets", exact: true });
  await expect(setsTab).toBeVisible();
  await setsTab.click();

  await expect(page).toHaveURL(/\/swaps/);
  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
});

test("phone calendar shows the My sets list, not the month grid", async ({ page }) => {
  // nina rather than bob: swaps.spec.ts hands bob's Sunday Morning drums to
  // kate, and the whole mobile project runs after the whole desktop one against
  // a db that global-setup seeds once per run — so by the time we get here bob
  // has no Sunday set left. Nothing mutates nina's roster; keep it that way, or
  // move this to another user no spec touches.
  await login(page, "nina");

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

test("phone calendar lists all upcoming sets by default, filterable to mine", async ({
  page,
}) => {
  // nina is on "Sunday Morning" but not "Saturday Prayer"; nothing mutates her
  // roster, so this stays valid across both device projects.
  await login(page, "nina");

  // Default shows every upcoming set — including one nina isn't on.
  await expect(
    page.getByText("Saturday Prayer").filter({ visible: true }).first()
  ).toBeVisible();
  await expect(
    page.getByText("Sunday Morning").filter({ visible: true }).first()
  ).toBeVisible();

  // "My sets" narrows to the ones she holds a slot on. Scope to visible: the
  // desktop month grid is also in the DOM here (hidden) and keeps Saturday
  // Prayer's chip, so an unscoped count would still see that hidden copy.
  // The desktop calendar's "Show sets for" control is also in the DOM (hidden
  // at phone widths) and substring-matches "Show sets"; scope to the visible
  // one, which is the mobile panel's select.
  await page
    .getByLabel("Show sets")
    .filter({ visible: true })
    .selectOption("mine");
  await expect(
    page.getByText("Saturday Prayer").filter({ visible: true })
  ).toHaveCount(0);
  await expect(
    page.getByText("Sunday Morning").filter({ visible: true }).first()
  ).toBeVisible();
});

test("phone: a private set stays hidden from a non-member", async ({ page }) => {
  // kate is neither on the seeded "Private Rehearsal" nor an admin.
  await login(page, "kate");
  const sets = (await (await page.request.get("/api/sets")).json()) as {
    label: string;
  }[];
  expect(sets.find((s) => s.label === "Private Rehearsal")).toBeFalsy();
  await expect(page.getByText("Private Rehearsal")).toHaveCount(0);
});

test("phone: a team-scoped cover shows only to the set's team", async ({ page }) => {
  // "Prayer Cover Mobile" is jack's open keys cover on the Prayer Room team.
  // paul (Prayer Room + keys) sees it; carol (keys, Sunday-only) does not.
  await login(page, "paul");
  await page.goto("/swaps");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Prayer Cover Mobile" })
      .filter({ hasText: "requested by Jack Jones" })
  ).toBeVisible();

  await login(page, "carol");
  await page.goto("/swaps");
  await expect(page.getByText("Prayer Cover Mobile")).toHaveCount(0);
});

test("phone Set Manager hides the desktop-only .ics export", async ({ page }) => {
  await login(page, "bob");
  await page.goto("/swaps");

  await expect(page.getByRole("heading", { name: "My Sets" })).toBeVisible();
  // The export button is desktop-only (hidden sm:block) — present but not shown.
  await expect(page.getByText("Export all my sets (.ics)")).toBeHidden();
});

test("phone Availabilities blocks a day without the desktop calendar", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/schedule");

  // The click-to-block calendar is desktop-only (hidden below lg), so on a
  // phone "Block out times" is the only way to add a block. It needs no admin
  // request, unlike the Admin Requests form above it.
  await expect(page.locator("[data-tour='avail-calendar']")).toBeHidden();

  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific date(s)" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  await blockOutTimes.getByRole("button", { name: "Block these dates" }).click();

  // It lands in the Busy Blocks list as an all-day entry.
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up so the block doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(blockEntry).toHaveCount(0);
});

test("phone: adds and deletes a recurring weekly block via the single-panel adder", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/schedule");

  // The single "Block out times" panel does both block kinds behind a toggle;
  // it defaults to specific, so switch to the weekly mode. This is the same
  // adder the desktop test drives — here at phone width, where it stacks to one
  // column instead of the sm two-column grid.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  await blockOutTimes.getByLabel("Day of week").selectOption("2"); // Tuesday
  await blockOutTimes.getByLabel("Time").selectOption("1"); // Morning preset
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  const entry = page.getByText(/Every Tuesday/);
  await expect(entry).toBeVisible();

  // Clean up.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(entry).not.toBeVisible();
});

test("phone: submits an availability response and re-opens it for changes", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  // The submit-confirmation modal is viewport-independent; make sure the whole
  // "Submit Response" → confirm → "Make changes" loop works on a phone too.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  // Nothing blocked → the modal says so.
  await expect(modal.getByText(/available the whole time/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText(/Submitted on|Updated on/)).toBeVisible();

  // "Make changes" re-opens the form (unsubmits) so the response can be edited.
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit Response" })
  ).toBeVisible();
});

test("phone: confirmation modal lists a blocked day, and the date picker marks it", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await page.goto("/schedule");

  const adminRequests = sectionByHeading(page, "Admin Requests");

  // Block today (an all-day block, the form's default preset) within the
  // active request's window.
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  await adminRequests.getByRole("button", { name: "Block these dates" }).click();

  // Re-opening the picker shows a red "full day" dot on today (the dayMarker).
  await adminRequests.getByLabel("Dates to block", { exact: true }).click();
  const todayCell = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(todayCell.locator(".bg-rose-500")).toBeVisible();
  await page.keyboard.press("Escape");

  // The submit-confirmation modal breaks the blocked day out instead of
  // claiming full availability.
  await page.getByRole("button", { name: "Submit Response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/available the whole time/)).toHaveCount(0);
  await expect(modal.getByText("All day")).toBeVisible();
  await modal.getByRole("button", { name: "Modify" }).click();
  await expect(modal).not.toBeVisible();

  // Clean up the block so it doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
});

// ── Cover Requests: accepting / rejecting a targeted swap by TAP. ───────────
// Reported symptom: on a phone, tapping "Accept" appeared to freeze the page.
// These use page.tap() rather than .click() on purpose — a tap dispatches real
// touch events, which is the only way SwipePager's window-level touchstart /
// touchmove / touchend handlers (components/SwipePager.tsx) get exercised. A
// mouse click would sail straight past the very code most likely to eat the
// gesture, so it could never reproduce the bug.

/**
 * Sets up a targeted swap proposed TO `toName` by `fromUsername`, entirely over
 * the API so it doesn't depend on which sets earlier specs have already traded.
 * Returns the accepting user's username.
 */
async function proposeSwapTo(
  page: import("@playwright/test").Page,
  fromUsername: string,
  toName: string
) {
  await login(page, fromUsername);

  // Every assignment of mine, newest API shape: { id, role, set: {...} }.
  const mine = (await (await page.request.get("/api/assignments")).json()) as {
    id: string;
    role: string;
    set: { startsAt: string };
  }[];
  expect(mine.length, `${fromUsername} has no assignments`).toBeGreaterThan(0);

  // Find the first of my slots that has `toName` as a swap candidate.
  let fromAssignmentId: string | undefined;
  let toAssignmentId: string | undefined;
  for (const a of mine) {
    const res = await page.request.get(
      `/api/swaps/candidates?assignmentId=${a.id}`
    );
    if (!res.ok()) continue;
    // GET /api/swaps/candidates → { items: [{ toAssignmentId, counterparty }] }
    const body = (await res.json()) as {
      items: { toAssignmentId: string; counterparty: { name: string } }[];
    };
    const hit = (body.items ?? []).find((c) => c.counterparty.name === toName);
    if (hit) {
      fromAssignmentId = a.id;
      toAssignmentId = hit.toAssignmentId;
      break;
    }
  }
  expect(
    fromAssignmentId,
    `no swap candidate named "${toName}" for ${fromUsername}`
  ).toBeTruthy();

  const proposed = await page.request.post("/api/swaps/propose", {
    data: { fromAssignmentId, toAssignmentId },
  });
  expect(proposed.ok(), `propose failed: ${proposed.status()}`).toBeTruthy();
}

test("phone: tapping Accept on a Cover Request resolves it (no freeze)", async ({
  page,
}) => {
  await proposeSwapTo(page, "erin", "Omar Osei");

  await login(page, "omar");
  await page.goto("/swaps");

  const card = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(card).toBeVisible();

  const accept = card.getByRole("button", { name: "Accept" });
  await expect(accept).toBeVisible();
  await accept.tap();

  // The whole point of the test: the tap must actually resolve. If the page
  // "freezes" (the busy spinner never clears, a stray swipe navigates away, or
  // the full-screen loader latches on) this is what fails.
  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/swaps/);
  // The accepted slot is now omar's, awaiting an admin's sign-off.
  await expect(page.getByText("Pending approval").first()).toBeVisible();
});

test("phone: tapping Reject on a Cover Request dismisses it (no freeze)", async ({
  page,
}) => {
  await proposeSwapTo(page, "erin", "Omar Osei");

  await login(page, "omar");
  await page.goto("/swaps");

  const card = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).tap();

  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/swaps/);
});
