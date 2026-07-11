// E2E: calendar tab — set list, team modal, stats windows, .ics export,
// and the admin inline "+" create / set delete flows.
import { Page, expect, test } from "@playwright/test";
import { login, openSetByLabel } from "./helpers";

// Open the "New set" form via the calendar's hover "+" button. Uses the last
// in-month day cell (always present, avoids month-boundary date math) and
// reveals its hidden "+" by hovering the containing cell first. Returns the
// open dialog with the label pre-filled.
async function openNewSetForm(page: Page, label: string) {
  const addButton = page.getByRole("button", { name: /^Add set on/ }).last();
  await addButton.locator("xpath=ancestor::div[1]").hover();
  await addButton.click();

  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: "New set" })).toBeVisible();
  await modal.getByLabel("Label").fill(label);
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

  // "Sunday Morning" also appears in the hidden mobile "My sets" panel (in the
  // DOM but display:none at desktop widths), so scope to a visible calendar
  // chip. Two Sunday sets exist; the first is bob's seeded one.
  const sundayCard = page
    .getByText("Sunday Morning")
    .filter({ visible: true })
    .first();
  await expect(sundayCard).toBeVisible();
  await sundayCard.click();

  // Modal lists the roster with roles and teammates.
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await expect(modal.getByText("Bob Baker")).toBeVisible(); // drums (bob)
  await expect(modal.getByText("Carol Chen")).toBeVisible(); // keys
  await expect(modal.getByText("Worship Leader")).toBeVisible();

  // Escape closes it.
  await page.keyboard.press("Escape");
  await expect(modal).not.toBeVisible();
});

test("'My Upcoming Sets' opens a sidebar listing the sets I'm on", async ({ page }) => {
  await login(page, "bob");
  await page.getByRole("button", { name: "My Upcoming Sets" }).click();

  // The mobile "My sets" list (hidden at desktop widths) repeats the set
  // names, so scope to the visible desktop sidebar <aside>.
  const panel = page
    .locator("aside")
    .filter({ hasText: "My sets", visible: true });
  await expect(panel.getByText("Sunday Morning")).toBeVisible();
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

  // The new set now shows as a chip on the calendar.
  await expect(page.getByText("Special Prayer Night")).toBeVisible();
});

test("admin deletes a set from the detail modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "To Be Deleted");

  // Open the set's team modal and delete it (two-step confirm).
  await page.getByText("To Be Deleted").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByRole("button", { name: "Delete set" }).click();
  await modal.getByRole("button", { name: "Confirm delete" }).click();

  // Modal closes and the chip is gone.
  await expect(modal).not.toBeVisible();
  await expect(page.getByText("To Be Deleted")).toHaveCount(0);
});

test("admin assigns and removes a player in the set modal", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Roster Test");

  // Open the (empty) set's team modal.
  await page.getByText("Roster Test").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();

  // Assign a worship leader to the open slot (any change starts as PENDING).
  // The slot is a custom PlayerSelect: click the box, then the option.
  const wlRow = modal
    .getByRole("listitem")
    .filter({ hasText: "Worship Leader" });
  await wlRow.getByRole("button", { name: "None" }).click();
  // Scope to the modal's listbox: the calendar's "Show sets for" filter is a
  // native <select> whose options include the same member names.
  await modal.getByRole("option", { name: "Jack Jones" }).click();
  await expect(wlRow.getByText("Pending confirmation")).toBeVisible();

  // Remove them again by re-opening the box and picking "None".
  // Exact match: the slot's ✕ button ("Remove … (Jack Jones)") would also
  // match a substring regex.
  await wlRow.getByRole("button", { name: "Jack Jones", exact: true }).click();
  await modal.getByRole("option", { name: "None" }).click();
  await expect(wlRow.getByText("Pending confirmation")).not.toBeVisible();
});

test("assignment dropdown flags people who are unavailable for the set", async ({
  page,
}) => {
  // Carol can't serve on Wednesdays (all day).
  await login(page, "carol");
  const res = await page.request.post("/api/availability", {
    data: { type: "RECURRING", dayOfWeek: 3, startMinute: 0, endMinute: 1440 },
  });
  expect(res.ok()).toBeTruthy();
  const blockId = (await res.json()).id as string;

  try {
    // Admin opens a seeded Wednesday Night set and its Piano / Keys dropdown.
    await login(page, "admin");
    await page.getByText("Wednesday Night").filter({ visible: true }).first().click();
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    const keysRow = modal.getByRole("listitem").filter({ hasText: "Piano / Keys" });
    await keysRow.getByRole("button", { name: "None" }).first().click();

    // Carol is still listed (so you can see her) but labelled + disabled...
    const carol = page.getByRole("option", { name: /Carol Chen \(unavailable\)/ });
    await expect(carol).toBeVisible();
    await expect(carol.getByRole("button")).toBeDisabled();
    // ...while an available keys player is selectable.
    await expect(
      page.getByRole("option", { name: "Nina Nguyen" }).getByRole("button")
    ).toBeEnabled();
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
  await expect(page.getByText("Filter Fixture")).toBeVisible();

  // Person filter → "My sets": admin isn't on it → hidden. Back to "Everyone"
  // shows it again.
  const personFilter = page.getByLabel("Show sets for");
  await personFilter.selectOption({ label: "My sets" });
  await expect(page.getByText("Filter Fixture")).toHaveCount(0);
  await personFilter.selectOption({ label: "Everyone" });
  await expect(page.getByText("Filter Fixture")).toBeVisible();

  // Status "Unconfirmed": an empty set has no pending assignment → hidden.
  await page.getByLabel("Set status").selectOption({ label: "Unconfirmed" });
  await expect(page.getByText("Filter Fixture")).toHaveCount(0);
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
  await modal.getByRole("option", { name: "Alice Admin" }).click();
  await expect(wlRow.getByText("Pending confirmation")).toBeVisible();

  await modal.getByRole("button", { name: "Auto schedule" }).click();

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

  // Strings has a single empty slot; its ✕ removes the whole row outright.
  await modal
    .getByRole("button", { name: "Remove empty Strings slot" })
    .click();
  await expect(
    modal.getByRole("button", { name: "Remove empty Strings slot" })
  ).toHaveCount(0);
  await expect(modal.getByText("Strings")).toHaveCount(0);
});

test("removing a filled slot asks for confirmation first", async ({ page }) => {
  await login(page, "admin");
  await createAdHocSet(page, "Slot Purge Night");
  const modal = await openSetByLabel(page, "Slot Purge Night");

  // Put a drummer in the (single) drums slot.
  const drumsRow = modal.getByRole("listitem").filter({ hasText: "Drums" });
  await drumsRow.getByRole("button", { name: "None" }).click();
  await modal.getByRole("option", { name: "Bob Baker" }).click();
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
