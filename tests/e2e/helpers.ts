// Shared e2e helpers.
import { Locator, Page, TestInfo, expect } from "@playwright/test";

// Local YYYY-MM-DD, matching lib/dates.toYmd (the format the picker's cells use
// in their data-date). Inlined so this test helper needs no app import.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

/**
 * The <section> whose own <h2> is `heading`.
 *
 * Prefer this over `.filter({ hasText })` for page sections: several headings
 * are also mentioned in neighbouring prose (the Availabilities page name-drops
 * "Block out times" inside a request card), and hasText matches any
 * descendant text — so it silently resolves to two sections and the call fails
 * on strict mode. Matching on the heading element pins it to the real one.
 */
export function sectionByHeading(page: Page, heading: string): Locator {
  return (
    page
      .locator("section")
      .filter({ has: page.getByRole("heading", { name: heading, exact: true }) })
      // Sections nest — "Block out times" sits inside "My availability" — and a
      // filter matches every ancestor that contains the heading, which makes
      // every chained lookup resolve one copy per matching section. The LAST
      // match is the innermost, i.e. the panel the heading actually titles.
      .last()
  );
}

/**
 * The nth org's join key from the test env's ORG_KEYS ("Name:key,Name:key").
 * Playwright loads env/test.env, so this matches what the app server sees.
 */
export function orgKey(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  const key = entry.slice(entry.lastIndexOf(":") + 1).trim();
  expect(key, `no ORG_KEYS entry at index ${index}`).toBeTruthy();
  return key;
}

/**
 * In an already-open DateSelect popup, pick today as a one-day range.
 *
 * The availability forms use `range` DateSelects, where the first click sets
 * the range start and leaves the popup open for the end; a second "Today" click
 * completes it as a single day and closes the popup. One click alone would
 * leave a half-open range, an unfilled field, and a disabled submit button.
 *
 * We click until the popup actually closes rather than assuming exactly two.
 * On WebKit the two clicks can outrun React's re-render, so the second click
 * reads the stale "no start yet" state and just re-opens a start; retrying
 * until the "Today" button is gone rides that out (and is a no-op extra check
 * on Chromium, where two clicks already suffice).
 */
export async function pickSingleDay(page: Page) {
  const dialog = page.getByRole("dialog");
  // Today's grid cell, keyed by its `data-date` (YYYY-MM-DD) so it's the ONE
  // current-month cell — matching by day number alone is ambiguous when a
  // padding cell from an adjacent month shows the same number enabled (e.g. on
  // the 2nd, next month's "2" is a trailing padding day).
  const todayCell = dialog.locator(`[data-date="${ymd(new Date())}"]`);

  // One click sets the range start, which both availability forms accept as a
  // single-day block (they require only the start; endDate is optional). We
  // deliberately do NOT complete the range with a second same-day click: on
  // WebKit that second click is unreliable and left the popup open. Confirm the
  // start committed (the cell renders selected) — retrying because on WebKit a
  // click can land just before React commits.
  await expect(async () => {
    await todayCell.click();
    await expect(todayCell).toHaveClass(/bg-indigo-600/, { timeout: 1500 });
  }).toPass({ timeout: 10_000 });

  // Close the picker so the form's submit button underneath is interactable.
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 1500 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Suppress every first-run tour — the app-wide walkthrough AND the review
 * workspace's own, either of which otherwise opens over the page and eats the
 * clicks a test is trying to make. addInitScript runs before page scripts on
 * each navigation, so the "seen" flags are set for the whole session. Any test
 * that doesn't go through `login()` (e.g. a custom sign-up flow) must call this
 * itself before its first navigation.
 */
export async function suppressGuidedTour(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("guided-tour-seen", "1");
      localStorage.setItem("schedule-tour-seen:generate", "1");
      localStorage.setItem("schedule-tour-seen:preview", "1");
    } catch {
      /* private mode — ignore */
    }
  });
}

/**
 * Undo the review-workspace half of the above, for the one spec that is about
 * the tour opening by itself. Init scripts run in the order they were added, so
 * calling this AFTER `login()` clears what login's script just set — on every
 * navigation, which is the only way to beat a script that re-runs on each one.
 */
export async function allowScheduleTours(page: Page) {
  await page.addInitScript(() => {
    try {
      // ONCE, not on every navigation: the point of the spec that calls this is
      // that the tour records itself as seen and stops coming back, and a
      // script that re-cleared the flag on each page load would wipe exactly
      // the thing under test.
      if (sessionStorage.getItem("e2e-schedule-tours-allowed")) return;
      sessionStorage.setItem("e2e-schedule-tours-allowed", "1");
      localStorage.removeItem("schedule-tour-seen:generate");
      localStorage.removeItem("schedule-tour-seen:preview");
    } catch {
      /* private mode — ignore */
    }
  });
}

/** Log in through the real login form. All seed users share one password. */
export async function login(
  page: Page,
  usernameOrEmail: string,
  password = "password123"
) {
  await suppressGuidedTour(page);
  await page.goto("/login");
  const userField = page.getByLabel("Username / Email");
  const passField = page.getByLabel("Password");
  // Fill and confirm both values stick before submitting. On WebKit (the iPhone
  // project) filling one field can silently wipe the other — Safari
  // credential-autofill clears the counterpart once one is populated, and React
  // hydration can flush a controlled input typed into before it's interactive.
  // Re-fill only the field that actually lost its value each pass, so the fill
  // that finally makes one stick can't clobber the other; the retry also rides
  // out the hydration race. (The old code re-filled password FIRST every pass,
  // so the following username fill wiped it and every WebKit login failed.)
  // Chromium satisfies this on the first pass.
  await expect(async () => {
    if ((await passField.inputValue()) !== password) await passField.fill(password);
    if ((await userField.inputValue()) !== usernameOrEmail) {
      await userField.fill(usernameOrEmail);
    }
    await expect(passField).toHaveValue(password);
    await expect(userField).toHaveValue(usernameOrEmail);
  }).toPass({ timeout: 15_000 });
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/calendar/);
}

/**
 * Open a set's detail modal by deep-linking to /calendar?set=<id> (looked up
 * by label via the API). More reliable than clicking the calendar chip, which
 * can sit in a crowded day cell's collapsed overflow. Returns the open modal.
 */
export async function openSetByLabel(page: Page, label: string) {
  const sets = (await (await page.request.get("/api/sets")).json()) as {
    id: string;
    label: string | null;
  }[];
  const match = sets.find((s) => s.label === label);
  expect(match, `no set labelled "${label}"`).toBeTruthy();

  await page.goto(`/calendar?set=${match!.id}`);
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: label })).toBeVisible();
  return modal;
}

/**
 * Create an active availability request (as admin) covering a wide range, so
 * the Availabilities page shows its input forms. Leaves the session logged in
 * as admin — callers log in as the user they want afterward.
 */
export async function requestAvailability(page: Page) {
  await login(page, "admin");
  // Admin routes are org-scoped: name the org via the x-org-id header. The
  // seeded admin administers exactly one org (the first/oldest).
  const orgs = (await (await page.request.get("/api/orgs")).json()) as {
    id: string;
    isAdmin: boolean;
  }[];
  const adminOrg = orgs.find((o) => o.isAdmin);
  expect(adminOrg, "admin has no admin org").toBeTruthy();
  const res = await page.request.post("/api/admin/availability-request", {
    headers: { "x-org-id": adminOrg!.id },
    data: { startDate: "2026-07-01", endDate: "2026-12-31" },
  });
  expect(res.ok()).toBeTruthy();
}

/**
 * A token unique to this ATTEMPT, for names/labels a test creates.
 *
 * global-setup reseeds once per RUN, not per test, so a retry inherits whatever
 * its failed attempt already created — and a test that asserts on a *fresh*
 * thing (an empty log, a name nobody has yet) then fails on every retry for the
 * wrong reason. Tagging what the test creates keeps each attempt independent.
 */
export function attemptTag(testInfo: TestInfo): string {
  return testInfo.retry ? `R${testInfo.retry}` : "";
}

/**
 * Delete every availability block the logged-in user has.
 *
 * The suite shares one database, so a spec that leaves blocks behind changes
 * what later ones see — a stray all-day block turns "available the whole time"
 * into a list of blocked days. Tests that add blocks call this before they
 * finish AND at the start, because a run that dies in between (a click that
 * times out mid-test) otherwise leaves residue that makes every retry fail on
 * the leftover rather than on whatever actually went wrong.
 */
/**
 * `page.goto` plus a wait for the app to actually be ready to drive.
 *
 * `goto` resolves on the document's `load` event, which on this app is well
 * before there's anything to click: the shared overlay (LoadingProvider) is
 * still covering the viewport, and the page's own content doesn't render until
 * its first fetch lands. Measured on /schedule at phone width, the form these
 * tests click into does not exist until ~860ms after load — at which point the
 * body's height nearly doubles — and the overlay stays mounted until ~2.3s
 * while it fades.
 *
 * A bare `goto` therefore hands the test a page that is still assembling, and
 * the first click races the reflow. Waiting for the overlay to LEAVE the DOM
 * is the one signal that works on every page, since each one drives it through
 * usePageLoading().
 */
export async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  // The navbar renders on mount with no data of its own, so this proves React
  // is up — and therefore that the page has already reported itself as
  // loading — before the overlay's absence is allowed to mean anything.
  await expect(page.locator("nav").first()).toBeVisible();
  await expect(page.getByTestId("page-loading")).toHaveCount(0);
}

export async function clearBusyBlocks(page: Page) {
  const { entries } = (await (
    await page.request.get("/api/availability")
  ).json()) as { entries: { id: string }[] };
  for (const entry of entries) {
    await page.request.delete(`/api/availability/${entry.id}`);
  }
}
