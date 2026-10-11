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
  clearBusyBlocks,
  gotoReady,
  login,
  pickSingleDay,
  requestAvailability,
  sectionByHeading,
} from "./helpers";

test("phone shows the bottom tab bar and navigates with it", async ({ page }) => {
  await login(page, "bob");

  // The desktop tab strip is display:none on phones (getByRole ignores hidden),
  // so only the bottom bar's copy of each tab is reachable — and it navigates.
  const setsTab = page.getByRole("link", { name: "My Sets", exact: true });
  await expect(setsTab).toHaveCount(1);
  await expect(setsTab).toBeVisible();
  await setsTab.click();

  await expect(page).toHaveURL(/\/set-manager/);
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
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
  await page.goto("/set-manager");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Prayer Cover Mobile" })
      .filter({ hasText: "requested by Jack Jones" })
  ).toBeVisible();

  await login(page, "carol");
  await page.goto("/set-manager");
  await expect(page.getByText("Prayer Cover Mobile")).toHaveCount(0);
});

test("phone: the set modal's staged edits and sticky footer work on a phone", async ({
  page,
}) => {
  // The detail modal stages every edit behind a sticky Delete · Cancel · Save
  // row. On a phone that row is the only way to commit or back out — there's no
  // room for it to scroll away — so it's worth proving it's reachable and that
  // the discard guard still names what would be lost.
  await login(page, "admin");
  await page.goto("/calendar");
  await page
    .getByText("Sunday Morning")
    .filter({ visible: true })
    .first()
    .click();

  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  // Nothing staged yet: Save is inert but present without scrolling.
  const save = modal.getByRole("button", { name: "Save", exact: true });
  await expect(save).toBeVisible();
  await expect(save).toBeDisabled();

  // Stage an edit reachable with one thumb: the ⋮ menu's Private toggle. (The
  // notes box isn't staged — its arrow sends immediately — so it can't stand in
  // for a pending change here.)
  await modal.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await expect(modal.getByText("1 unsaved change")).toBeVisible();
  await expect(save).toBeEnabled();

  // Backing out warns, and names the change.
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  const warning = page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .last();
  await expect(warning.getByText("Made the set private")).toBeVisible();
  await warning.getByRole("button", { name: "Discard changes" }).click();
  await expect(modal).not.toBeVisible();

  // Nothing reached the server.
  const sets = (await (await page.request.get("/api/sets")).json()) as {
    label: string | null;
    isPrivate: boolean;
  }[];
  const sunday = sets.find((s) => s.label === "Sunday Morning");
  expect(sunday?.isPrivate).toBe(false);
});

test("phone My Sets hides the desktop-only .ics export", async ({ page }) => {
  await login(page, "bob");
  await page.goto("/set-manager");

  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
  // The export button is desktop-only (hidden sm:block) — present but not shown.
  await expect(page.getByText("Export all my sets (.ics)")).toBeHidden();
});

test("phone Availabilities blocks a day without the desktop calendar", async ({
  page,
}) => {
  await login(page, "carol");
  // Start from a clean slate: a previous run that died mid-test would have
  // left a block behind, and this test's own "it's gone again" assertion would
  // then fail on the leftover rather than on anything it did.
  await clearBusyBlocks(page);
  await gotoReady(page, "/schedule");

  // The month calendar is desktop-only (hidden below lg); the phone gets the
  // week strip instead, and the form below it still works either way. Neither
  // needs an availability request, unlike the request cards above them.
  // NB this assertion is worth nothing as a WAIT — a locator that doesn't
  // exist yet is "hidden", so before gotoReady it passed on a blank page and
  // let the clicks below start mid-render. gotoReady is the sync point.
  await expect(page.locator("[data-tour='avail-calendar']")).toBeHidden();

  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific times" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  // No time window is ticked by default — say all day explicitly.
  await blockOutTimes.getByRole("checkbox", { name: "All day" }).click();
  await blockOutTimes.getByRole("button", { name: "Block these times" }).click();

  // It lands in the My availability list as an all-day entry.
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();

  // Clean up so the block doesn't leak into later specs.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(blockEntry).toHaveCount(0);
});

test("phone week strip blocks a day with one tap", async ({ page }) => {
  await login(page, "carol");
  // Carol's blocks are this file's shared mutable state — five tests add and
  // remove them. Clearing here (rather than trusting the previous test to have
  // tidied up) is what stops one failure from cascading into the rest: the
  // "it's gone again" assertion at the end counts ALL her blocks.
  await clearBusyBlocks(page);
  await gotoReady(page, "/schedule");

  // The strip replaces the desktop calendar below lg: today is always in the
  // week it opens on, and tapping a free day blocks it all day.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayYmd = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}`;
  // The desktop month grid is still in the DOM (hidden by CSS at this width) and
  // renders a cell per day too, so take the one actually on screen.
  const todayCell = page.locator(`[data-date="${todayYmd}"]:visible`).first();
  await expect(todayCell).toBeVisible();
  await todayCell.click();

  // It lands in the My availability list, and the cell now reads as blocked.
  const blockEntry = page.getByRole("listitem").filter({ hasText: "All day" });
  await expect(blockEntry.first()).toBeVisible();
  await expect(todayCell).toHaveAttribute("aria-pressed", "true");

  // Tapping it again clears it — the same toggle the calendar's click has.
  await todayCell.click();
  await expect(blockEntry).toHaveCount(0);
});

test("phone: adds and deletes a recurring weekly block via the single-panel adder", async ({
  page,
}) => {
  await login(page, "carol");
  await clearBusyBlocks(page); // own state — see the note two tests above
  await gotoReady(page, "/schedule");

  // The single "Block out times" panel does both block kinds behind a toggle;
  // it defaults to specific, so switch to the weekly mode. This is the same
  // adder the desktop test drives — here at phone width, where it stacks to one
  // column instead of the sm two-column grid.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Every week" }).click();
  // Days are a multi-select strip and times a checkbox list: Tuesday is on by
  // default, but no time window is — pick Morning.
  await expect(
    blockOutTimes.getByRole("button", { name: "Tuesday" })
  ).toHaveAttribute("aria-pressed", "true");
  await blockOutTimes.getByRole("checkbox", { name: "Morning (6am–12pm)" }).click();
  await blockOutTimes
    .getByRole("button", { name: "Add recurring block" })
    .click();

  // The row this test created, not just its text: the Delete below has to be
  // THIS row's. `page`-wide `Delete.first()` deleted whichever block happened
  // to sort first — usually but not always this one — so the assertion that
  // followed was a coin flip on what else the run had left in the list.
  const entry = page.getByRole("listitem").filter({ hasText: /Every Tuesday/ });
  await expect(entry.first()).toBeVisible();

  // Clean up.
  await entry.first().getByRole("button", { name: "Delete" }).click();
  await expect(entry).toHaveCount(0);
});

test("phone: submits an availability response and re-opens it for changes", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  // Not optional here: the modal below is asserted to say carol is "available
  // the whole time", which is only true with no blocks on her. This test used
  // to inherit that state from whichever test ran before it.
  await clearBusyBlocks(page);
  await gotoReady(page, "/schedule");

  // The submit-confirmation modal is viewport-independent; make sure the whole
  // "Submit response" → confirm → "Make changes" loop works on a phone too.
  await page.getByRole("button", { name: "Submit response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  // Nothing blocked → the modal says so.
  await expect(modal.getByText(/available the whole time/)).toBeVisible();
  await modal.getByRole("button", { name: "Confirm" }).click();
  // The card flips to a "Completed" badge.
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();

  // "Make changes" re-opens it (unsubmits) so the response can be edited.
  await page.getByRole("button", { name: "Make changes" }).click();
  await expect(
    page.getByRole("button", { name: "Submit response" })
  ).toBeVisible();
});

test("phone: confirmation modal lists a blocked day, and the date picker marks it", async ({
  page,
}) => {
  await requestAvailability(page);
  await login(page, "carol");
  await clearBusyBlocks(page); // see the note in the test above
  await gotoReady(page, "/schedule");

  // No calendar on a phone, so the general "Block out times" form is the only
  // way to block a day inside the active request's window.
  const blockOutTimes = sectionByHeading(page, "Block out times");
  await blockOutTimes.getByRole("button", { name: "Specific times" }).click();
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  await pickSingleDay(page);
  // No time window is ticked by default — say all day explicitly.
  await blockOutTimes.getByRole("checkbox", { name: "All day" }).click();
  await blockOutTimes.getByRole("button", { name: "Block these times" }).click();

  // Re-opening the picker shows a red "full day" dot on today (the dayMarker).
  await blockOutTimes.getByLabel("Dates to block", { exact: true }).click();
  const todayCell = page
    .getByRole("dialog")
    .getByRole("button", { name: String(new Date().getDate()), exact: true });
  await expect(todayCell.locator(".bg-rose-500")).toBeVisible();
  await page.keyboard.press("Escape");

  // The submit-confirmation modal breaks the blocked day out instead of
  // claiming full availability.
  await page.getByRole("button", { name: "Submit response" }).click();
  const modal = page
    .getByRole("dialog")
    .filter({ hasText: "Submit your response?" });
  await expect(modal).toBeVisible();
  await expect(modal.getByText(/available the whole time/)).toHaveCount(0);
  await expect(modal.getByText("All day")).toBeVisible();
  await modal.getByRole("button", { name: "Modify" }).click();
  await expect(modal).not.toBeVisible();

  // Clean up the block so it doesn't leak into later specs — and WAIT for it to
  // go. Firing the click and ending the test can close the context before the
  // DELETE lands, leaving a stray "All day" block that trips the next spec's
  // "no blocks left" check.
  await page.getByRole("button", { name: "Delete" }).first().click();
  await expect(
    page.getByRole("listitem").filter({ hasText: "All day" })
  ).toHaveCount(0);
});

// ── Covers / Swaps: accepting / rejecting a targeted swap by TAP. ──────────
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
  await page.goto("/set-manager");

  const card = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(card).toBeVisible();

  const accept = card.getByRole("button", { name: "Accept" });
  await expect(accept).toBeVisible();
  await accept.tap();

  // The whole point of the test: the tap must actually resolve. If the page
  // "freezes" (the busy spinner never clears, a stray swipe navigates away, or
  // the full-screen loader latches on) this is what fails.
  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/set-manager/);
  // The accepted slot is now omar's, awaiting an admin's sign-off.
  await expect(page.getByText("Pending approval").first()).toBeVisible();
});

test("phone: tapping Reject on a Cover Request dismisses it (no freeze)", async ({
  page,
}) => {
  await proposeSwapTo(page, "erin", "Omar Osei");

  await login(page, "omar");
  await page.goto("/set-manager");

  const card = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reject" }).tap();

  // Reject now opens the decline modal (with an optional note) rather than
  // declining on the spot — so the phone path has to get through the dialog
  // too. Skipping the note is the common case and the one to keep covered
  // here; the note itself is swap-decline.spec.ts's job.
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("heading", { name: "Decline this swap" })
  ).toBeVisible();
  await modal.getByRole("button", { name: "Decline", exact: true }).tap();

  await expect(card).toHaveCount(0, { timeout: 15_000 });
  await expect(page).toHaveURL(/\/set-manager/);
});

// The roster-health dot is a phone-only addition to the "My sets" list: on
// desktop it rides on the month grid's set chips, and the phone has no grid to
// carry it, so the list row is the only place the information can live. Read
// only — safe for both device projects to run.
test("phone My sets rows carry the roster-health dot the month grid can't", async ({
  page,
}) => {
  // nina for the same reason the list test above uses her: nothing mutates her
  // roster, and the mobile project runs against a db the desktop one has
  // already worked over.
  await login(page, "nina");

  // Prove we're on the phone path — the month grid (and its "Today" nav) is
  // gone, so any dot we find belongs to the list.
  await expect(page.getByRole("button", { name: "Today" })).toHaveCount(0);

  // Every dot names its own state, since colour alone can't say which red it
  // is (see components/StatusDot.tsx).
  const dots = page.getByLabel(
    /^(Cover requested|Needs people — open slots|Waiting on confirmations|Fully confirmed)$/
  );
  await expect(dots.first()).toBeVisible();
});

// The notes composer on a phone: the arrow sends on tap (no keyboard needed for
// a one-line note) and the note appears as a bubble under the box. Sending is
// immediate — it is NOT part of the staged Save, which the staged-edits test
// above relies on.
test("phone: sending a note posts it immediately and shows it in the log", async ({
  page,
}, testInfo) => {
  await login(page, "admin");

  // Both device projects run this file against the same seeded db, so the note
  // carries its project's name — the second run then asserts on its OWN bubble
  // rather than tripping over the first's.
  const note = `Phone note from ${testInfo.project.name}`;

  await page.getByText("Wednesday Night").filter({ visible: true }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  const box = modal.getByPlaceholder("e.g. Communion Sunday");
  const send = modal.getByRole("button", { name: "Send note" });
  await expect(send).toBeDisabled(); // nothing to send yet

  await box.fill(note);
  await expect(send).toBeEnabled();
  await send.click();

  // Sent, not staged: the box empties and the newest bubble is this note.
  await expect(box).toHaveValue("");
  await expect(modal.getByTestId("note-entry").first()).toContainText(note);

  // It really reached the server — reopening the set (a fresh fetch) still
  // shows it, and the composer comes back empty rather than pre-filled.
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(modal).not.toBeVisible();
  await page.getByText("Wednesday Night").filter({ visible: true }).first().click();
  await expect(
    page.getByRole("dialog").getByTestId("note-entry").first()
  ).toContainText(note);
  await expect(
    page.getByRole("dialog").getByPlaceholder("e.g. Communion Sunday")
  ).toHaveValue("");
});

test("phone calendar hides the desktop-only Preview Mode button", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/calendar");

  // Preview Mode lives in the month grid's toolbar, and the whole month grid
  // is desktop-only — the phone gets My Sets instead. It's in the DOM (the
  // wrapper is `hidden md:block`) but never shown.
  await expect(page.getByRole("button", { name: "Preview Mode" })).toBeHidden();
});
