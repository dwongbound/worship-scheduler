// E2E: admin-only Create tab — templates, generation, availability status.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

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
  await page.getByRole("button", { name: "Auto schedule…" }).click();
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
  await modal.getByLabel("Duration").selectOption("90"); // 1.5 Hrs
  await modal.getByRole("button", { name: "Add template" }).click();
  // The new template shows as a table row: Name | "Sundays · 9:00 AM" (the day
  // is pluralized now that a template can cover several days).
  await expect(page.getByText(/Sundays · 9:00 AM/)).toBeVisible();

  // Run the scheduler for 4 weeks — this stages a preview, it doesn't save yet.
  // The scope + template picks live in the "Auto schedule" dialog now.
  // (Target the number input by role: "Weeks ahead" also appears as an option
  // in the "Schedule for" select, so getByLabel alone is ambiguous.)
  await page.getByRole("button", { name: "Auto schedule…" }).click();
  const options = page.getByRole("dialog");
  await options.getByRole("spinbutton", { name: "Weeks ahead" }).fill("4");
  await options.getByRole("button", { name: "Generate preview" }).click();

  // The review modal opens; it shows the Team load panel (the "who plays
  // often" rehaul) and set cards. Applying it commits the sets + assignments.
  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await expect(review.getByText("Team load")).toBeVisible();
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
  await page.getByRole("button", { name: "Auto schedule…" }).click();
  const options = page.getByRole("dialog");
  await options.getByRole("spinbutton", { name: "Weeks ahead" }).fill("16");
  await options.getByRole("button", { name: "Generate preview" }).click();

  const review = page.getByRole("dialog");
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  await expect(review.getByText("Thursday Rehearsal").first()).toBeVisible();

  // Scope to a Thursday card (cards carry a testid; the sets are grouped in
  // per-label rows), open its Vox dropdown, and confirm an "(unavailable)"
  // candidate is offered (never silently hidden or assigned).
  const card = review
    .getByTestId("staged-set-card")
    .filter({ hasText: "Thursday Rehearsal" })
    .first();
  const vocalsRow = card
    .getByRole("listitem")
    .filter({ hasText: "Vox" });
  await vocalsRow.getByRole("button").first().click();
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
  // From/To are custom DateSelect popups (not native date inputs). Their button's
  // accessible name is exactly "From"/"To (optional)", so open each with an
  // EXACT label match (getByLabel("To") without exact is ambiguous — "Today"
  // contains "to") and choose "Today" scoped to the open popup dialog. A
  // single-day range is valid (startDate <= endDate).
  const pickToday = async (field: "From" | "To (optional)") => {
    await page.getByLabel(field, { exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Today", exact: true })
      .click();
  };

  await pickToday("From");
  await pickToday("To (optional)");
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
