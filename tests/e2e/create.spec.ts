// E2E: admin-only Create tab — templates, generation, availability status.
import { expect, test } from "@playwright/test";
import { login, pickSingleDay } from "./helpers";

test("non-admins don't see the Create tab and can't use the page", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("link", { name: "Create" })).not.toBeVisible();

  // Direct navigation is blocked too.
  await page.goto("/create");
  await expect(
    page.getByText("You need admin access for this page.")
  ).toBeVisible();
});

// Runs BEFORE the "generate + apply" test below on purpose: applying commits
// sets across the next few weeks, which would consume most of the seeded
// request's window and leave this request-scoped generate empty. Generating
// against the pristine window keeps it deterministic. It only previews +
// discards, so it doesn't pollute later tests.
test("admin can generate for an availability request's date range", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/create");

  // Pick a request (the seed ships "Fall 2026") as the generate scope. The
  // option value is "req:<id>"; select the first such option regardless of its
  // (date-dependent) label.
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const scope = options.getByLabel("Schedule for");
  const reqValue = await scope
    .locator('option[value^="req:"]')
    .first()
    .getAttribute("value");
  expect(reqValue).toBeTruthy();
  await scope.selectOption(reqValue!);

  // A summary of the resolved range appears, then generating stages a preview.
  await expect(options.getByText(/^Scheduling /)).toBeVisible();
  await options.getByRole("button", { name: "Generate preview" }).click();

  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  // Discard so we don't commit anything from this scope test. Leaving the
  // preview asks first, since the plan lives only in the browser.
  await review.getByRole("button", { name: "Discard" }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Discard this preview?" });
  await confirm.getByRole("button", { name: "Discard" }).click();
});

// Runs before the apply test for the same reason as the one above: it only
// previews and discards, against the still-pristine request window.
test("re-running the auto schedule inside the preview doesn't crash it", async ({
  page,
}) => {
  // A smoke test for the plan-wide button: click it and the modal must survive.
  // A React render crash doesn't leave a tidy error on the page, it leaves a
  // hole where the UI was, so the assertion that carries the weight is the
  // uncaught exception itself, not the visibility check after it.
  //
  // Scope, honestly: no SEED TEMPLATE sets requiresMD (only the "Saturday
  // Prayer" set does), so a generated plan has no MD to designate and this does
  // NOT exercise the MD rotation — verified by reintroducing the crash, which
  // this test happily passed. The rotation is covered where it belongs, in
  // tests/unit/stagedPlan.test.ts (designateMDs), which does fail against it.
  // Making this reach the MD path would mean seeding a requiresMD template.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await login(page, "admin");
  await page.goto("/create");

  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const scope = options.getByLabel("Schedule for");
  const reqValue = await scope
    .locator('option[value^="req:"]')
    .first()
    .getAttribute("value");
  expect(reqValue).toBeTruthy();
  await scope.selectOption(reqValue!);
  await expect(options.getByText(/^Scheduling /)).toBeVisible();
  await options.getByRole("button", { name: "Generate preview" }).click();

  const review = page.getByRole("dialog");
  const heading = review.getByRole("heading", {
    name: "Review generated schedule",
  });
  await expect(heading).toBeVisible();

  // The plan-wide button reads "Auto schedule all" on an empty plan and
  // "Re-run auto schedule" once anyone is on it — either way it runs the same
  // pass, which is the one that used to throw.
  await review
    .getByRole("button", { name: /Auto schedule all|Re-run auto schedule/ })
    .click();

  // Still standing, still showing the plan, and nothing blew up on the way.
  await expect(heading).toBeVisible();
  expect(pageErrors).toEqual([]);

  await review.getByRole("button", { name: "Discard" }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Discard this preview?" });
  await confirm.getByRole("button", { name: "Discard" }).click();
});

test("admin can add a weekly template and generate a schedule", async ({ page }) => {
  await login(page, "admin");
  // The admin tabs live under a hover "Admin" dropdown — reveal it first.
  await page.getByRole("button", { name: "Admin", exact: true }).hover();
  await page.getByRole("link", { name: "Create" }).click();
  await expect(page.getByRole("heading", { name: "Create Sets" })).toBeVisible();

  // Open the "add weekly set time" popup, then add "every Sunday 9:00, 90 min".
  await page.getByRole("button", { name: "Add weekly set time" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Label").fill("Sunday Service");
  // A template is created for each checked day and must name a team (its
  // members are who the generated sets can be staffed from).
  await modal.getByLabel("Team").selectOption({ label: "Sunday Team" });
  // Target the day by role: getByLabel("Sunday") also matches the Team select,
  // whose accessible name concatenates its option text ("…Sunday Team…").
  await modal.getByRole("checkbox", { name: "Sunday" }).check();
  await modal.getByLabel("Start time").fill("09:00");
  // The form asks for an end time now; 9:00 → 10:30 is the same 90 minutes.
  await modal.getByLabel("End time").fill("10:30");
  await modal.getByRole("button", { name: "Add template" }).click();
  // The new template shows as a table row: Name | "Sundays · 9:00 AM" (the day
  // is pluralized now that a template can cover several days).
  await expect(page.getByText(/Sundays · 9:00 AM/)).toBeVisible();

  // Run the scheduler for 4 weeks — this stages a preview, it doesn't save yet.
  // The scope + template picks live in the "Generate New Schedule" dialog now.
  // (Target the number input by role: "Weeks ahead" also appears as an option
  // in the "Schedule for" select, so getByLabel alone is ambiguous.)
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const weeks = options.getByRole("spinbutton", { name: "Weeks ahead" });
  // "Weeks ahead" is a stepper: − / + either side of a still-typeable field.
  await weeks.fill("5");
  await options.getByRole("button", { name: "Decrease Weeks ahead" }).click();
  await expect(weeks).toHaveValue("4");
  await options.getByRole("button", { name: "Generate preview" }).click();

  // The review modal opens; it shows the Team load panel (the "who plays
  // often" rehaul) and set cards. Applying it commits the sets + assignments.
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  // Exact: the panel's window selector carries a screen-reader label that also
  // contains "team load".
  await expect(review.getByText("Team load", { exact: true })).toBeVisible();

  // The panel measures this plan by default and never queries for it; picking a
  // past window is one on-demand request (GET /api/admin/team-load), after
  // which the footnote says what the bars are showing.
  const loadQuery = page.waitForResponse(
    (r) => r.url().includes("/api/admin/team-load") && r.ok()
  );
  await review
    .getByLabel("Measure team load by")
    .selectOption({ label: "Past month" });
  await loadQuery;
  await expect(review.getByText(/bars show past month/)).toBeVisible();
  // Back to the plan's own numbers, with no second request needed.
  await review
    .getByLabel("Measure team load by")
    .selectOption({ label: "In this plan" });
  await expect(review.getByText(/bars show past month/)).toHaveCount(0);

  await review.getByRole("button", { name: "Apply schedule" }).click();
  await expect(page.getByText(/Created \d+ sets and \d+ assignments/)).toBeVisible();
});

test("review dropdowns flag people who are unavailable at a set's time", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/create");

  // Generate a wide window — the seed has "Thursday Rehearsal", and Grace is
  // unavailable every Thursday, so she must show as a flagged (but still
  // listed) option in a Thursday set's roster dropdowns. Use a large window so
  // there are always fresh (unstaffed) Thursdays to review, even if an earlier
  // test already staffed the nearest few weeks.
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  await options.getByRole("spinbutton", { name: "Weeks ahead" }).fill("16");
  await options.getByRole("button", { name: "Generate preview" }).click();

  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await expect(review.getByText("Thursday Rehearsal").first()).toBeVisible();

  // Scope to a Thursday card (cards carry a testid; the sets are grouped in
  // per-label rows), open its Vox dropdown, and confirm an "unavailable"-
  // flagged candidate is offered (never silently hidden or assigned).
  const card = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Thursday Rehearsal" })
    .first();
  const vocalsRow = card
    .getByRole("listitem")
    .filter({ hasText: "Vox" });
  // The dropdown trigger specifically — a slot row leads with its ✕ (remove
  // the slot) and, when locked, a 🔒, so "the first button" is not it.
  await vocalsRow.locator('button[aria-haspopup="listbox"]').first().click();
  await expect(
    page.getByRole("listbox").getByText(/unavailable/i).first()
  ).toBeVisible();
});

test("admin can set a custom team shape on a template", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  await page.getByRole("button", { name: "Add weekly set time" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Label").fill("Tuesday Morning");
  await modal.getByLabel("Team").selectOption({ label: "Sunday Team" });
  await modal.getByRole("checkbox", { name: "Tuesday" }).check();
  await modal.getByLabel("Start time").fill("09:00");

  // Custom shape: 3 electric guitars, no acoustic guitar (opt into the editor).
  await modal.getByRole("button", { name: "Customize team shape" }).click();
  await modal.getByLabel("Electric Guitar").fill("3");
  await modal.getByLabel("Acoustic Guitar").fill("0");
  await modal.getByRole("button", { name: "Add template" }).click();

  // The template's table row summarizes only the non-default roles (regex
  // avoids the "×" glyph). Scope to the row so the assertion is unambiguous.
  const row = page.getByRole("row").filter({ hasText: "Tuesday Morning" });
  await expect(row).toContainText(/3.* Electric Guitar/);
  await expect(row).toContainText("no Acoustic Guitar");
});

test("admin sends an availability request to the team", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  await page.getByLabel("Name (optional)").fill("Fall 2026 Request");
  // The dates are ONE custom `range` DateSelect popup (not native date inputs):
  // open it by its exact label, then pick today as the range start. The form
  // takes a start alone as a one-day request, which is all this test needs —
  // pickSingleDay owns the click-and-close dance (it's fiddly on WebKit).
  await page
    .getByLabel("Dates to ask about", { exact: true })
    .click();
  await pickSingleDay(page);

  await page.getByRole("button", { name: "Request availabilities" }).click();
  await expect(
    page.getByText("Availability request sent to the team.")
  ).toBeVisible();

  // The custom name shows on the Availabilities page (both the reminder
  // banner and the request line pick it up, hence .first()).
  await page.goto("/schedule");
  await expect(page.getByText(/Fall 2026 Request/).first()).toBeVisible();
});

test("admin sees everyone's availability completion status", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/create");

  // Every seeded user appears with a scheduling status badge.
  await expect(page.getByRole("cell", { name: "Bob Baker" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kate Kim" })).toBeVisible();
  expect(await page.getByText("Not yet").count()).toBeGreaterThan(0);
});

// Last in the file, and it deletes the template it makes: generated plans are
// built from templates, so one left behind would change what every later
// generate in the run sees.
test("re-running the preview settles MDs on a plan that requires them", async ({
  page,
}) => {
  // The MD path, end to end. The smoke test earlier in this file clicks the
  // same button but never reaches this code: no SEED template sets requiresMD,
  // so its plan has no director to designate — it passed happily against the
  // crash that took the modal down. This one builds a template that DOES
  // require an MD, so re-running walks the chained pass in lib/stagedPlan
  // designateMDs for real.
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await login(page, "admin");
  await page.goto("/create");
  await expect(page.getByRole("heading", { name: "Create Sets" })).toBeVisible();

  await page.getByRole("button", { name: "Add weekly set time" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Label").fill("MD Rotation Check");
  // Sunday Team holds every seeded user, which is where the two musical
  // directors (jack + paul, both on keys) live.
  await modal.getByLabel("Team").selectOption({ label: "Sunday Team" });
  // By role: getByLabel("Sunday") also matches the Team select, whose
  // accessible name concatenates its option text.
  await modal.getByRole("checkbox", { name: "Sunday" }).check();
  await modal.getByLabel("Start time").fill("14:00");
  await modal.getByLabel("End time").fill("15:30");
  // The whole point — generated sets from this template want a director.
  await modal.getByRole("checkbox", { name: "Add MD" }).check();
  await modal.getByRole("button", { name: "Add template" }).click();

  // The template table pages at four rows and earlier tests in this file add
  // their own, so a new row isn't necessarily on page 1 — walk the pages to it
  // rather than assuming. (Asserting against page 1 alone passed in isolation
  // and failed in a full run, which is exactly the sort of order-dependence
  // worth not baking in.)
  // The page has two paged tables (templates, then availability status), so an
  // unscoped "Next" is a strict-mode violation — and the pager renders OUTSIDE
  // the Recurring <section>, so scoping to that section finds no pager at all
  // and silently never turns the page. Templates are the first table on the
  // page, so take the first pager.
  const nextTemplatePage = page.getByRole("button", { name: "Next" }).first();
  const findTemplateRow = async (name: RegExp) => {
    for (;;) {
      const row = page.getByRole("row", { name });
      if (await row.count()) return row.first();
      if (await nextTemplatePage.isDisabled()) {
        throw new Error(`No template row matching ${name} on any page`);
      }
      await nextTemplatePage.click();
    }
  };
  await expect(await findTemplateRow(/MD Rotation Check/)).toBeVisible();

  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const weeks = options.getByRole("spinbutton", { name: "Weeks ahead" });
  await weeks.fill("4");
  await options.getByRole("button", { name: "Generate preview" }).click();

  const review = page.getByRole("dialog");
  const heading = review.getByRole("heading", {
    name: "Review generated schedule",
  });
  await expect(heading).toBeVisible();

  // The server designated MDs on the way out — the "* (MD)" marker rides inside
  // the chosen person's box. Seeing it here proves the plan actually carries
  // MD-requiring sets, which is what the earlier smoke test lacks.
  await expect(review.getByText("* (MD)").first()).toBeVisible();

  // Clearing first is what makes this bite. Re-running over a plan whose MDs
  // are still VALID keeps each existing pick and never re-derives anything — so
  // the chained pass is skipped and the crash stays hidden (this test passed
  // against the bug until this step was added). Emptying the plan invalidates
  // every director, so the re-run has to pick them all again from scratch.
  await review.getByRole("button", { name: "Clear all people" }).click();
  await expect(review.getByText("* (MD)")).toHaveCount(0);

  // Now the button that crashed, on a plan that must re-derive every MD,
  // chaining each set's pick off the one before it.
  await review.getByRole("button", { name: /Auto schedule all|Re-run auto schedule/ }).click();

  // Directors are back, the modal survived, and nothing blew up getting there.
  await expect(heading).toBeVisible();
  await expect(review.getByText("* (MD)").first()).toBeVisible();
  expect(pageErrors).toEqual([]);

  // Deliberately NOT asserting that consecutive sets get different directors.
  // Both seeded MDs also play worship leader, and a WL can't direct the same
  // set — so whenever the filler seats one of them as WL, the other is the only
  // eligible director and correctly leads again (instrument beats person). The
  // rotation itself is pinned in tests/unit/stagedPlan.test.ts, where the
  // roster is controlled.
  await review.getByRole("button", { name: "Discard" }).click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Discard this preview?" });
  await confirm.getByRole("button", { name: "Discard" }).click();

  // Clean up so the template can't leak into another spec's generate. Waiting
  // on the DELETE itself rather than on the row disappearing: deletion can
  // collapse the paging, which would make the row vanish from view whether or
  // not the request succeeded.
  const deleted = page.waitForResponse(
    (r) =>
      r.url().includes("/api/admin/templates/") &&
      r.request().method() === "DELETE" &&
      r.ok()
  );
  const row = await findTemplateRow(/MD Rotation Check/);
  await row.getByRole("button", { name: "Delete" }).click();
  await deleted;
});

test("the workspace opens straight onto a skeleton, never the empty state", async ({
  page,
}) => {
  await login(page, "admin");

  // Hold the generate response so the in-flight state is a fixed thing to look
  // at rather than a frame that may or may not be caught.
  await page.route("**/api/admin/generate", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });

  await page.goto("/create");
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const scope = options.getByLabel("Schedule for");
  const reqValue = await scope
    .locator('option[value^="req:"]')
    .first()
    .getAttribute("value");
  await scope.selectOption(reqValue!);
  await options.getByRole("button", { name: "Generate preview" }).click();

  // The full workspace is up immediately, wearing a skeleton — the options
  // dialog does not sit there spinning and then hand over.
  const review = page
    .getByRole("dialog")
    .filter({ hasText: "Review generated schedule" });
  await expect(review).toBeVisible();
  await expect(review.getByTestId("workspace-skeleton")).toBeVisible();
  await expect(options.getByRole("button", { name: "Generate preview" })).toHaveCount(0);

  // And it is the SAME panel, not a smaller one standing in: measured while
  // loading and again once the plan is in, it must not resize underneath you.
  // The skeleton used to fall back to the default centred card, which read as a
  // second modal flashing past on the way to the real one.
  const loadingBox = await review.boundingBox();
  expect(loadingBox).not.toBeNull();

  // Watch for the in-between states rather than polling for them. Both bugs
  // here were ONE render long — far too short for an expect() poll to land on,
  // so a plain toHaveCount(0) passes whether or not they happen. A
  // MutationObserver runs on every DOM commit, which is exactly the resolution
  // needed to prove a frame was never painted.
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as Window & { __flashes?: string[] }).__flashes = seen;
    const watched = [
      "Nothing to schedule in this window", // the old empty-state branch
      "0 sets · 0 assignments", // a fully-drawn but empty workspace
      "Nobody assigned yet.", // the same, in the Team load panel
    ];
    new MutationObserver(() => {
      const text = document.body.innerText;
      for (const phrase of watched) {
        if (text.includes(phrase) && !seen.includes(phrase)) seen.push(phrase);
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });

  // Then the real thing fills in where the grey was.
  await expect(review.getByTestId("staged-set-card").first()).toBeVisible();
  await expect(review.getByTestId("workspace-skeleton")).toHaveCount(0);
  await expect(review.getByText("Nothing to schedule in this window")).toHaveCount(0);

  // Nothing empty was ever on screen: the skeleton was replaced by the finished
  // plan in one step.
  const flashes = await page.evaluate(
    () => (window as Window & { __flashes?: string[] }).__flashes ?? []
  );
  expect(flashes).toEqual([]);

  const loadedBox = await review.boundingBox();
  expect(loadedBox).not.toBeNull();
  expect(Math.abs(loadedBox!.width - loadingBox!.width)).toBeLessThan(2);
  expect(Math.abs(loadedBox!.height - loadingBox!.height)).toBeLessThan(2);
});
