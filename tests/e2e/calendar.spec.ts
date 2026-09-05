// E2E: calendar tab — set list, team modal, stats windows, .ics export,
// and the admin inline "+" create / set delete flows.
import { Page, expect, test } from "@playwright/test";
import {
  attemptTag,
  login,
  openSetByLabel,
  requestAvailability,
} from "./helpers";

// Open the "New set" form via the calendar's hover "+" button. Uses the last
// in-month day cell (always present, avoids month-boundary date math) and
// reveals its hidden "+" by hovering the containing cell first. Returns the
// open dialog with the label pre-filled.
// One person in an open roster dropdown. PlayerSelect portals its list to
// document.body (so no scrolling ancestor can clip it — see the component), so
// the options are NOT inside the set modal's dialog and can't be looked up
// through it. Scoping to the open listbox instead keeps the calendar's own
// "Show sets for" <select> out of the match.
function playerOption(page: Page, name: string) {
  // Substring, not exact: an option's accessible name also carries the flags and
  // the "×N recently scheduled" badge PlayerSelect appends to it.
  return page.getByRole("listbox").getByRole("option", { name });
}

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

// Create an empty ad-hoc set (the plain "Create set" path).
async function createAdHocSet(page: Page, label: string) {
  const modal = await openNewSetForm(page, label);
  await modal.getByRole("button", { name: "Create set" }).click();
  await expect(modal).not.toBeVisible();
}

test("shows upcoming sets and opens the team modal", async ({ page }) => {
  await login(page, "bob");

  // Deep-link to the roster modal by label — month-independent. The seeded
  // "Sunday Morning" can land in the *next* month's grid (e.g. when today is a
  // late-month Sunday), where it has no visible chip to click. openSetByLabel
  // resolves the id via the API and opens the modal directly.
  const modal = await openSetByLabel(page, "Sunday Morning");

  // Modal lists the roster with roles and teammates.
  await expect(modal.getByText("Bob Baker")).toBeVisible(); // drums (bob)
  await expect(modal.getByText("Carol Chen")).toBeVisible(); // keys
  await expect(modal.getByText("Worship Leader")).toBeVisible();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
});

test("'Upcoming Sets' sidebar shows all sets by default, filterable to mine", async ({ page }) => {
  await login(page, "bob");
  await page.getByRole("button", { name: "Upcoming Sets" }).click();

  // The mobile list (hidden at desktop widths) repeats the set names, so scope
  // to the visible desktop sidebar <aside>.
  const panel = page
    .locator("aside")
    .filter({ hasText: "Upcoming sets", visible: true });

  // Default (scope "all") lists every upcoming set — including "Saturday
  // Prayer", which bob (Sunday Team) is not on. Two "Sunday Morning" sets are
  // seeded (this week + two out), so take the first.
  await expect(panel.getByText("Sunday Morning").first()).toBeVisible();
  await expect(panel.getByText("Saturday Prayer")).toBeVisible();

  // Switching the "Show sets" filter to "My sets" drops the ones bob isn't on.
  await panel.getByLabel("Show sets").selectOption("mine");
  await expect(panel.getByText("Sunday Morning").first()).toBeVisible();
  await expect(panel.getByText("Saturday Prayer")).toHaveCount(0);
});

test("the sidebar stays inside the viewport under a banner", async ({ page }) => {
  // With a reminder banner in the header the page is that much shorter. The
  // sidebar used to cap itself at a hardcoded `100vh - 6rem`, which ignored the
  // banner and pushed the whole calendar into a page scroll.
  await requestAvailability(page);
  await login(page, "bob");
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Upcoming Sets" }).click();

  const panel = page
    .locator("aside")
    .filter({ hasText: "Upcoming sets", visible: true });
  await expect(panel).toBeVisible();

  const overflow = await page.evaluate(() => {
    const aside = document.querySelector("aside");
    const asideBottom = aside ? aside.getBoundingClientRect().bottom : 0;
    return {
      page: document.documentElement.scrollHeight - window.innerHeight,
      aside: asideBottom - window.innerHeight,
    };
  });
  expect(overflow.page).toBeLessThanOrEqual(1);
  expect(overflow.aside).toBeLessThanOrEqual(1);
});

test("non-admins get no inline '+' create button", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("button", { name: /^Add set on/ })).toHaveCount(0);
});

test("admin creates an ad-hoc set inline from a day cell", async ({ page }) => {
  await login(page, "admin");
  const modal = await openNewSetForm(page, "Special Prayer Night");
  // The form only creates an empty set — auto-scheduling lives in the set
  // detail modal now, so no "Auto schedule" here.
  await expect(
    modal.getByRole("button", { name: "Auto schedule" })
  ).toHaveCount(0);
  await modal.getByRole("button", { name: "Create set" }).click();
  await expect(modal).not.toBeVisible();

  // The new set now shows as a chip on the calendar. The label also appears in
  // the always-rendered (but hidden) mobile panel, so scope to the visible one.
  await expect(
    page.getByText("Special Prayer Night").filter({ visible: true }).first()
  ).toBeVisible();
});

test("admin deletes a set from the detail modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "To Be Deleted");

  // Open the set's team modal and delete it. Scope to the visible grid chip
  // (the hidden mobile panel repeats the label).
  await page.getByText("To Be Deleted").filter({ visible: true }).first().click();
  const modal = page.getByRole("dialog").first();
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Delete set" }).click();
  // Deleting raises a stacked confirm modal, nested inside the set modal.
  const confirm = modal.getByRole("dialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Delete set" }).click();

  // Modal closes and the chip is gone.
  await expect(modal).not.toBeVisible();
  await expect(page.getByText("To Be Deleted")).toHaveCount(0);
});

test("admin assigns and removes a player in the set modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Roster Test");

  // Open the (empty) set's team modal (visible grid chip, not the hidden
  // mobile panel's repeat of the label).
  await page.getByText("Roster Test").filter({ visible: true }).first().click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  // Assign a worship leader to the open slot (any change starts as PENDING).
  // The slot is a custom PlayerSelect: click the box, then the option.
  const wlRow = modal
    .getByRole("listitem")
    .filter({ hasText: "Worship Leader" });
  await wlRow.getByRole("button", { name: "None" }).click();
  await playerOption(page, "Jack Jones").click();
  await expect(wlRow.getByText("Pending confirmation")).toBeVisible();

  // Remove them again by re-opening the box and picking "None".
  // Exact match: the slot's ✕ button ("Remove … (Jack Jones)") would also
  // match a substring regex.
  await wlRow.getByRole("button", { name: "Jack Jones", exact: true }).click();
  await playerOption(page, "None").click();
  await expect(wlRow.getByText("Pending confirmation")).not.toBeVisible();
});

test("assignment dropdown flags people who are unavailable for the set", async ({
  page,
}) => {
  // Carol can't serve on Wednesdays (all day). Clean up any matching block
  // a previous (e.g. timed-out) attempt might have left behind — otherwise a
  // retry hits a 409 "already exists" and fails deterministically every time.
  await login(page, "carol");
  const existing = (await (await page.request.get("/api/availability")).json())
    .entries as { id: string; type: string; dayOfWeek: number | null }[];
  for (const e of existing) {
    if (e.type === "RECURRING" && e.dayOfWeek === 3) {
      await page.request.delete(`/api/availability/${e.id}`);
    }
  }
  const res = await page.request.post("/api/availability", {
    data: { type: "RECURRING", dayOfWeek: 3, startMinute: 0, endMinute: 1440 },
  });
  expect(res.ok()).toBeTruthy();
  const blockId = (await res.json()).id as string;

  try {
    // Admin opens the seeded Wednesday Night set and its Vox (VOCALS) row —
    // seeded with only 1 of its 3 slots filled (Grace), so 2 stay open. Carol
    // plays KEYS + VOCALS but her seeded Keys slot (Ivy) and the other roles
    // are already filled, so Vox is the only role with an open slot she
    // qualifies for.
    await login(page, "admin");
    // Deep-link to the set instead of clicking its calendar chip: near a
    // month's end the seeded Wednesday set can land in the next month, which
    // the calendar isn't showing, so the chip wouldn't be visible to click.
    const modal = await openSetByLabel(page, "Wednesday Night");

    const voxRow = modal.getByRole("listitem").filter({ hasText: "Vox" });
    await voxRow.getByRole("button", { name: "None" }).first().click();

    // Carol is flagged "(unavailable)" so an admin can see the conflict...
    const carol = page.getByRole("option", { name: /Carol Chen \(unavailable\)/ });
    await expect(carol).toBeVisible();
    // ...but she stays selectable — the flag is a warning an admin may override
    // (see PlayerSelect: unavailable people are muted, not disabled).
    await expect(carol.getByRole("button")).toBeEnabled();
    // An available vocalist carries no "(unavailable)" flag. Scope to the
    // dropdown option's button — "Nina Nguyen" also names an <option> in the
    // calendar's native "Show sets for" <select>, which has no button child.
    await expect(
      page.getByRole("option", { name: /Nina Nguyen \(unavailable\)/ })
    ).toHaveCount(0);
    await expect(
      page.getByRole("option", { name: "Nina Nguyen" }).getByRole("button")
    ).toBeVisible();
  } finally {
    // Tests share one serial db — remove Carol's block so it can't leak into
    // later specs (e.g. schedule.spec, which also acts as Carol).
    await login(page, "carol");
    await page.request.delete(`/api/availability/${blockId}`);
  }
});

test("exports the current user's sets as an .ics file", async ({ page }) => {
  await login(page, "bob");
  // page.request shares the browser's session cookies.
  const response = await page.request.get("/api/export");
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["content-type"]).toContain("text/calendar");

  const body = await response.text();
  expect(body).toContain("BEGIN:VCALENDAR");
  // One event per set, titled "<set> (<my role>)" — bob drums his Sunday set.
  expect(body).toContain("SUMMARY:Sunday Morning (Drums)");
});

test("exports a single set as .ics with my role in the title", async ({ page }) => {
  await login(page, "bob");
  // Find bob's seeded Sunday Morning set id via the API.
  const sets = await (await page.request.get("/api/sets")).json();
  const sunday = sets.find(
    (s: { label: string; assignments: { user: { name: string } }[] }) =>
      s.label === "Sunday Morning" &&
      s.assignments.some((a) => a.user.name === "Bob Baker")
  );
  expect(sunday).toBeTruthy();

  const res = await page.request.get(`/api/export/${sunday.id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.text();
  expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(1); // just this set
  expect(body).toContain("SUMMARY:Sunday Morning (Drums)");
});

test("filters the calendar by my sets and by status", async ({ page }) => {
  await login(page, "admin");
  // An empty set (no team) that admin is NOT assigned to.
  await createAdHocSet(page, "Filter Fixture");

  // These filters act on the desktop grid; the mobile panel is always in the
  // DOM (hidden here) with its own separate filter and keeps its copy of the
  // label, so every assertion scopes to the visible grid chip.
  const chip = page.getByText("Filter Fixture").filter({ visible: true });
  await expect(chip.first()).toBeVisible();

  // "Show sets for" → "My sets": admin isn't on it → hidden. Back to "All sets"
  // shows it again.
  const personFilter = page.getByLabel("Show sets for");
  await personFilter.selectOption({ label: "My sets" });
  await expect(chip).toHaveCount(0);
  await personFilter.selectOption({ label: "All sets" });
  await expect(chip.first()).toBeVisible();

  // Status "Unconfirmed": an empty set has no pending assignment → hidden.
  await page.getByLabel("Set status").selectOption({ label: "Unconfirmed" });
  await expect(chip).toHaveCount(0);
});

test("admin auto-schedules a set's open slots around a hand-picked player", async ({
  page,
}) => {
  await login(page, "admin");
  // Give the set its own start instant so it can't collide with the other
  // ad-hoc sets tests drop on the same (last) day cell.
  const form = await openNewSetForm(page, "Auto Fill Night");
  await form.getByLabel("Start time").fill("14:22");
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  const modal = await openSetByLabel(page, "Auto Fill Night");

  // Hand-pick the worship leader first — auto schedule must keep her.
  const wlRow = modal
    .getByRole("listitem")
    .filter({ hasText: "Worship Leader" });
  await wlRow.getByRole("button", { name: "None" }).click();
  await playerOption(page, "Alice Admin").click();
  await expect(wlRow.getByText("Pending confirmation")).toBeVisible();

  await modal.getByRole("button", { name: "Auto schedule" }).click();
  // Edits are staged now — nothing reaches the server until Save.
  await modal.getByRole("button", { name: "Save", exact: true }).click();

  // The open slots filled in as PENDING; the hand-picked worship leader
  // stayed exactly as she was (the fill works around her).
  await expect(async () => {
    const sets = (await (await page.request.get("/api/sets")).json()) as {
      label: string | null;
      assignments: { role: string; status: string; user: { name: string } }[];
    }[];
    const created = sets.find((s) => s.label === "Auto Fill Night");
    expect(created).toBeTruthy();
    expect(created!.assignments.length).toBeGreaterThan(1);
    expect(created!.assignments.every((a) => a.status === "PENDING")).toBe(true);
    const leaders = created!.assignments.filter(
      (a) => a.role === "WORSHIP_LEADER"
    );
    expect(leaders).toHaveLength(1);
    expect(leaders[0].user.name).toBe("Alice Admin");
  }).toPass();
});

test("admin removes an empty role slot with its ✕ (no confirm)", async ({
  page,
}) => {
  await login(page, "admin");
  await createAdHocSet(page, "Slot Trim Night");
  const modal = await openSetByLabel(page, "Slot Trim Night");

  // Acoustic Guitar has a single empty slot; its ✕ removes the whole row
  // outright. (Strings used to play this part, but the default team shape no
  // longer gives it any slots — see SLOT_CAPACITIES.)
  await modal
    .getByRole("button", { name: "Remove empty Acoustic Guitar slot" })
    .click();
  await expect(
    modal.getByRole("button", { name: "Remove empty Acoustic Guitar slot" })
  ).toHaveCount(0);
  await expect(modal.getByText("Acoustic Guitar")).toHaveCount(0);
});

test("removing a filled slot asks for confirmation first", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Slot Purge Night");
  const modal = await openSetByLabel(page, "Slot Purge Night");

  // Put a drummer in the (single) drums slot.
  const drumsRow = modal.getByRole("listitem").filter({ hasText: "Drums" });
  await drumsRow.getByRole("button", { name: "None" }).click();
  await playerOption(page, "Bob Baker").click();
  await expect(drumsRow.getByText("Pending confirmation")).toBeVisible();

  // ✕ on the filled slot opens a confirm modal (the person would go with the
  // slot); Cancel keeps everything. The confirm is nested inside the set
  // modal's dialog, so .last() picks the inner one.
  const slotX = modal.getByRole("button", {
    name: "Remove Drums slot (Bob Baker)",
  });
  await slotX.click();
  const confirm = page
    .getByRole("dialog")
    .filter({ hasText: "Remove Drums slot?" })
    .last();
  await expect(confirm.getByText(/Bob Baker is assigned/)).toBeVisible();
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Remove Drums slot?")).toHaveCount(0);
  await expect(
    // Exact match: the slot's ✕ button ("Remove … (Bob Baker)") would also
    // match a substring regex.
    drumsRow.getByRole("button", { name: "Bob Baker", exact: true })
  ).toBeVisible();

  // Confirming removes both the person and the slot — drums (now 0-capacity
  // and empty) drops off the roster entirely.
  await slotX.click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Remove Drums slot?" })
    .last()
    .getByRole("button", { name: "Remove slot" })
    .click();
  await expect(slotX).toHaveCount(0);
  await expect(
    modal.getByRole("button", { name: "Remove empty Drums slot" })
  ).toHaveCount(0);
});

test("leaving the set modal with staged edits asks first and lists them", async ({
  page,
}) => {
  await login(page, "admin");
  await createAdHocSet(page, "Staged Edit Night");
  const modal = await openSetByLabel(page, "Staged Edit Night");

  // Nothing staged yet → Save is inert and Cancel just closes.
  await expect(modal.getByRole("button", { name: "Save", exact: true })).toBeDisabled();

  // Stage one roster change.
  const drumsRow = modal.getByRole("listitem").filter({ hasText: "Drums" });
  await drumsRow.getByRole("button", { name: "None" }).click();
  await playerOption(page, "Bob Baker").click();
  await expect(modal.getByText("1 unsaved change")).toBeVisible();

  // Cancel now warns, naming the change rather than just saying "unsaved".
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  const warning = page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .last();
  await expect(warning.getByText("Added Bob Baker on Drums")).toBeVisible();

  // "Keep editing" leaves everything exactly as it was.
  await warning.getByRole("button", { name: "Keep editing" }).click();
  await expect(page.getByText("Discard your changes?")).toHaveCount(0);
  await expect(modal.getByText("1 unsaved change")).toBeVisible();

  // Discarding closes the modal and never touches the server.
  await modal.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard your changes?" })
    .last()
    .getByRole("button", { name: "Discard changes" })
    .click();
  await expect(modal).not.toBeVisible();

  const sets = (await (await page.request.get("/api/sets")).json()) as {
    label: string | null;
    assignments: unknown[];
  }[];
  expect(sets.find((s) => s.label === "Staged Edit Night")!.assignments).toHaveLength(0);
});

// The set detail modal's Notes history: sending a note logs it, and NOTHING
// else appears in that section — roster changes belong to the Team tab's
// activity log, not here. The box itself is a composer: empty on open, sent by
// its arrow, never part of the staged Save.
//
// Works on a set of its own (tagged per attempt) so the log starts genuinely
// empty — the seeded sets are shared with the rest of this file.
test("a sent note lands in the set's Notes history, and nothing else does", async ({
  page,
}, testInfo) => {
  await login(page, "admin");
  const label = `Notes Log Night${attemptTag(testInfo)}`;
  const form = await openNewSetForm(page, label);
  await form.getByLabel("Start time").fill("15:10");
  await form.getByRole("button", { name: "Create set" }).click();
  await expect(form).not.toBeVisible();

  const modal = await openSetByLabel(page, label);
  const notes = modal.getByPlaceholder("e.g. Communion Sunday");
  const send = modal.getByRole("button", { name: "Send note" });

  // Nothing written yet, and the arrow is inert until there's something to send.
  await expect(modal.getByText("No notes yet.")).toBeVisible();
  await expect(send).toBeDisabled();

  // The note goes the moment the arrow is clicked — it isn't staged for Save —
  // and the box empties behind it.
  await notes.fill("Bring extra cables");
  await expect(send).toBeEnabled();
  await send.click();
  await expect(notes).toHaveValue("");
  // The row shows the message plainly, under who wrote it and when.
  const first = modal.getByTestId("note-entry").first();
  await expect(first).toContainText("Bring extra cables");
  await expect(first).toContainText("Alice Admin");

  // A second note goes on top and keeps the first one below it.
  await notes.fill("Doors at 7:30");
  await send.click();
  await expect(modal.getByTestId("note-entry").first()).toContainText(
    "Doors at 7:30"
  );
  await expect(modal.getByTestId("note-entry").nth(1)).toContainText(
    "Bring extra cables"
  );

  // A roster change on the same set writes its own history event — which must
  // NOT show up here. Assign the empty Bass slot and save (which closes the
  // modal, so the log is read on the way back in).
  const bassRow = modal.getByRole("listitem").filter({ hasText: "Bass" }).first();
  await bassRow.getByRole("button", { name: "None" }).click();
  await playerOption(page, "Dave Diaz").click();
  await modal.getByRole("button", { name: "Save", exact: true }).click();
  await expect(modal).not.toBeVisible();

  const reopened = await openSetByLabel(page, label);
  // Exact: the slot's own "Remove Bass slot (Dave Diaz)" ✕ also carries his
  // name, so a substring match resolves to two controls.
  await expect(
    reopened.getByRole("button", { name: "Dave Diaz", exact: true })
  ).toBeVisible();
  // Still exactly the two notes entries — no "added Dave Diaz as Bass".
  await expect(reopened.getByTestId("note-entry")).toHaveCount(2);
  // And the composer is empty again, even though this set has notes.
  await expect(
    reopened.getByPlaceholder("e.g. Communion Sunday")
  ).toHaveValue("");
});
