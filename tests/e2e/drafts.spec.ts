// E2E: saving a generated preview as a draft, reopening it, and deleting it.
//
// Drafts are Create-tab only: the calendar's Preview Mode mirrors real sets, so
// there's nothing to park. The Drafts button is hidden until one exists, which
// is the first thing this checks.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

// Open the Create tab and stage a preview from the seeded availability request.
async function openPreview(page: import("@playwright/test").Page) {
  await page.goto("/create");
  await page.getByRole("button", { name: "Generate New Schedule" }).click();
  const options = page.getByRole("dialog");
  const scope = options.getByLabel("Schedule for");
  const reqValue = await scope
    .locator('option[value^="req:"]')
    .first()
    .getAttribute("value");
  await scope.selectOption(reqValue!);
  await expect(options.getByText(/^Scheduling /)).toBeVisible();
  await options.getByRole("button", { name: "Generate preview" }).click();
  // Pinned by its own heading, not just "a dialog": the save prompt and the
  // guided tour stack OVER this one, so an unfiltered lookup goes ambiguous
  // the moment either is open.
  const review = page
    .getByRole("dialog")
    .filter({ hasText: "Review generated schedule" });
  await expect(
    review.getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();
  return review;
}

test("an admin saves a preview as a draft, reopens it, and deletes it", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/create");

  // Nothing saved yet, so the button isn't there at all.
  await expect(page.getByRole("button", { name: "Drafts" })).toHaveCount(0);

  const review = await openPreview(page);

  // Save Draft asks for a name before it writes anything.
  await review.getByRole("button", { name: "Save Draft" }).click();
  const saveDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Save this preview as a draft?" });
  await saveDialog.getByLabel("Name (optional)").fill("Advent plan");

  // It says what a draft buys you, and what it costs, before you spend a slot.
  await expect(saveDialog.getByText(/Reopen it any time/)).toBeVisible();
  await expect(saveDialog.getByText(/5 saved drafts at a time/)).toBeVisible();

  await saveDialog.getByRole("button", { name: "Confirm" }).click();

  // Confirming parks the plan AND leaves: the work is on the server, so there
  // is nothing left to keep the workspace open for — and no discard prompt,
  // which is only ever about unsaved work.
  await expect(saveDialog).toBeHidden();
  await expect(review).toBeHidden();
  await expect(
    page.getByRole("dialog").filter({ hasText: "Discard this preview?" })
  ).toHaveCount(0);

  // The button appears now that there's something behind it.
  const draftsButton = page.getByRole("button", { name: "Drafts" });
  await expect(draftsButton).toBeVisible();
  await draftsButton.click();

  // The row carries the name and who first saved it.
  const list = page.getByRole("dialog").filter({ hasText: "Drafts" });
  await expect(list.getByText("Advent plan")).toBeVisible();
  await expect(list.getByText(/Created .* by Alice Admin/)).toBeVisible();

  // Opening it puts the plan back in the review modal.
  await list.getByRole("button", { name: "Open Advent plan" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Review generated schedule" })
  ).toBeVisible();

  // Re-saving an opened draft prefills its name, and says it replaces it.
  await page.getByRole("button", { name: "Save Draft" }).click();
  const reSave = page.getByRole("dialog").filter({ hasText: "Save draft" });
  await expect(reSave.getByLabel("Name (optional)")).toHaveValue("Advent plan");
  await expect(reSave.getByText(/This replaces the draft you opened/)).toBeVisible();
  // Replacing one you already have is free — the cap only bites on new ones.
  await expect(reSave.getByText(/doesn’t use another/)).toBeVisible();
  await reSave.getByRole("button", { name: "Cancel" }).click();

  // Back out of the preview again, then delete the draft from the list.
  await page.getByRole("button", { name: "Discard" }).click();
  await page
    .getByRole("dialog")
    .filter({ hasText: "Discard this preview?" })
    .getByRole("button", { name: "Discard" })
    .click();
  await page.getByRole("button", { name: "Drafts" }).click();
  await page.getByRole("button", { name: "Delete Advent plan" }).click();

  // Deleting is irreversible, so it confirms — and confirming leaves you in the
  // list, because deleting is usually how you make room for another save.
  const confirm = page.getByRole("dialog").filter({ hasText: "Delete this draft?" });
  await expect(confirm.getByText(/can't be undone/)).toBeVisible();
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Advent plan")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
});

// A minimal plan body — the API only needs `plan` to be an object.
const PLAN = { plan: { sets: [], skipped: 0 } };

// Drafts persist across specs, so every test here clears up after itself.
async function deleteAllDrafts(page: import("@playwright/test").Page, orgId: string) {
  const list = await (
    await page.request.get("/api/admin/drafts", { headers: { "x-org-id": orgId } })
  ).json();
  for (const d of list as { id: string }[]) {
    await page.request.delete(`/api/admin/drafts/${d.id}`, {
      headers: { "x-org-id": orgId },
    });
  }
}

// The admin org id, as the page's own requests name it.
async function adminOrgId(page: import("@playwright/test").Page): Promise<string> {
  const orgs = await (await page.request.get("/api/orgs")).json();
  const admin = (orgs as { id: string; isAdmin: boolean }[]).find((o) => o.isAdmin);
  return admin!.id;
}

test("the sixth draft is refused until one is deleted", async ({ page }) => {
  await login(page, "admin");
  const orgId = await adminOrgId(page);
  await deleteAllDrafts(page, orgId);

  // Fill all five keep-slots through the API — the cap is what's under test,
  // not the five separate trips through the UI it would take to reach it.
  for (let i = 0; i < 5; i++) {
    const res = await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, name: `Draft ${i}` },
    });
    expect(res.ok()).toBe(true);
  }

  const review = await openPreview(page);
  await review.getByRole("button", { name: "Save Draft" }).click();
  const saveDialog = page
    .getByRole("dialog")
    .filter({ hasText: "Save this preview as a draft?" });
  await saveDialog.getByRole("button", { name: "Confirm" }).click();

  // Refused, and told why — deleting one is the way forward. The dialog stays
  // up (and so does the preview behind it): nothing was saved, so closing
  // either would be throwing the plan away.
  await expect(saveDialog.getByText(/Delete one before saving another/)).toBeVisible();
  await expect(review).toBeVisible();

  // And the remedy is right here: the five drafts are listed with a trash each,
  // so freeing a slot doesn't mean closing this, going to the Drafts list, and
  // retyping the name.
  await saveDialog.getByRole("button", { name: "Delete Draft 0" }).click();
  // Irreversible, so the trash asks before it acts — in place, not as a third
  // modal stacked over the save prompt.
  await saveDialog.getByRole("button", { name: "Delete", exact: true }).click();

  // A slot opened, so the refusal is retired and the save goes through.
  await expect(saveDialog.getByText(/Delete one before saving another/)).toHaveCount(0);
  await saveDialog.getByRole("button", { name: "Confirm" }).click();
  await expect(saveDialog).toBeHidden();
  await expect(review).toBeHidden();

  // Five again: one deleted, one saved.
  const after = (await (
    await page.request.get("/api/admin/drafts", { headers: { "x-org-id": orgId } })
  ).json()) as { name: string | null; isRecovery: boolean }[];
  expect(after.filter((d) => !d.isRecovery)).toHaveLength(5);
  expect(after.some((d) => d.name === "Draft 0")).toBe(false);

  await deleteAllDrafts(page, orgId);
});

test("autosaving replaces one recovery row instead of piling them up", async ({
  page,
}) => {
  await login(page, "admin");
  const orgId = await adminOrgId(page);
  await deleteAllDrafts(page, orgId);

  // Three autosaves, as a long preview session would make.
  for (let i = 0; i < 3; i++) {
    const res = await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, isRecovery: true },
    });
    expect(res.ok()).toBe(true);
  }

  const list = (await (
    await page.request.get("/api/admin/drafts", { headers: { "x-org-id": orgId } })
  ).json()) as { isRecovery: boolean }[];

  // One rolling slot, not a trail of them.
  expect(list.filter((d) => d.isRecovery)).toHaveLength(1);

  // And it doesn't spend a keep-slot: five deliberate saves still fit alongside.
  for (let i = 0; i < 5; i++) {
    const res = await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, name: `Keep ${i}` },
    });
    expect(res.ok()).toBe(true);
  }

  await deleteAllDrafts(page, orgId);
});

test("promoting the autosave to a kept draft still respects the cap", async ({
  page,
}) => {
  await login(page, "admin");
  const orgId = await adminOrgId(page);
  await deleteAllDrafts(page, orgId);

  // An autosave alongside five kept drafts — the state the recovery slot exists
  // for, since the keep-slots are full.
  const recovery = await (
    await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, isRecovery: true },
    })
  ).json();
  for (let i = 0; i < 5; i++) {
    await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, name: `Keep ${i}` },
    });
  }

  // Naming the recovery row turns it into a sixth kept draft, so it's refused
  // the same way a sixth POST is — the cap can't be walked around this way.
  const promote = await page.request.patch(`/api/admin/drafts/${recovery.id}`, {
    headers: { "x-org-id": orgId },
    data: { name: "Sneaky sixth" },
  });
  expect(promote.status()).toBe(409);

  // Re-saving one that's ALREADY kept is a replacement, not a sixth, so it goes
  // through even at the limit.
  const kept = (await (
    await page.request.get("/api/admin/drafts", { headers: { "x-org-id": orgId } })
  ).json()) as { id: string; isRecovery: boolean }[];
  const replace = await page.request.patch(
    `/api/admin/drafts/${kept.find((d) => !d.isRecovery)!.id}`,
    { headers: { "x-org-id": orgId }, data: { name: "Renamed" } }
  );
  expect(replace.ok()).toBe(true);

  await deleteAllDrafts(page, orgId);
});

test("an autosave never blanks a name someone chose", async ({ page }) => {
  await login(page, "admin");
  const orgId = await adminOrgId(page);
  await deleteAllDrafts(page, orgId);

  const saved = await (
    await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, name: "Advent" },
    })
  ).json();

  // The autosave PATCHes the plan and nothing else. `name` is only read when
  // the key is actually sent, so a draft you named keeps its name through a
  // whole session of autosaving over it.
  const auto = await page.request.patch(`/api/admin/drafts/${saved.id}`, {
    headers: { "x-org-id": orgId },
    data: { plan: { sets: [], skipped: 1 } },
  });
  expect(auto.ok()).toBe(true);
  expect((await auto.json()).name).toBe("Advent");

  // Sending the key explicitly IS a rename, including back to unnamed.
  const renamed = await page.request.patch(`/api/admin/drafts/${saved.id}`, {
    headers: { "x-org-id": orgId },
    data: { name: "" },
  });
  expect((await renamed.json()).name).toBeNull();

  await deleteAllDrafts(page, orgId);
});

test("a draft is reachable only by an admin of the org that owns it", async ({
  page,
}) => {
  await login(page, "admin");
  const orgId = await adminOrgId(page);
  await deleteAllDrafts(page, orgId);
  const saved = await (
    await page.request.post("/api/admin/drafts", {
      headers: { "x-org-id": orgId },
      data: { ...PLAN, name: "Admin only" },
    })
  ).json();

  // Bob is a member, not an admin. The id alone must not open the draft: the
  // org is derived from the DRAFT and re-checked, so there's no header to spoof.
  await login(page, "bob");
  expect((await page.request.get(`/api/admin/drafts/${saved.id}`)).status()).toBe(403);
  expect(
    (
      await page.request.patch(`/api/admin/drafts/${saved.id}`, {
        data: { name: "mine now" },
      })
    ).status()
  ).toBe(403);
  expect(
    (await page.request.delete(`/api/admin/drafts/${saved.id}`)).status()
  ).toBe(403);
  // Nor can he see the org's list at all.
  expect(
    (await page.request.get("/api/admin/drafts", { headers: { "x-org-id": orgId } })).status()
  ).toBe(403);

  // Still there, untouched.
  await login(page, "admin");
  expect((await (await page.request.get(`/api/admin/drafts/${saved.id}`)).json()).name).toBe(
    "Admin only"
  );
  await deleteAllDrafts(page, orgId);
});
