// E2E: the admin-only Team page — access control + editing a person's per-team
// roles (which auto-saves).
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("non-admins can't see or open the Team page", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("link", { name: "Team" })).not.toBeVisible();

  await page.goto("/users");
  await expect(
    page.getByText("You need admin access for this page.")
  ).toBeVisible();
});

test("admin edits a person's team roles and it persists", async ({ page }) => {
  await login(page, "admin");
  // The admin tabs live under a hover "Admin" dropdown — reveal it first.
  await page.getByRole("button", { name: "Admin", exact: true }).hover();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  // Roles are per-team: pick the Sunday team so its members' role checkboxes
  // show (the picker resets to "All members" on reload, so re-select each time).
  // Bob plays only Drums there — add Strings. Edits save automatically
  // (optimistic UI + a background PATCH), so wait for the PATCH before reload.
  const pickSunday = () =>
    page.getByTestId("team-filter").selectOption({ label: "Sunday Team" });
  await pickSunday();

  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.request().method() === "PATCH"
    );
  const bobStrings = () =>
    page
      .getByRole("listitem")
      .filter({ hasText: "Bob Baker" })
      .getByLabel("Strings");

  await expect(bobStrings()).not.toBeChecked();
  await Promise.all([savePatch(), bobStrings().check()]);

  // Reload to prove it was persisted server-side, not just local state.
  await page.reload();
  await pickSunday();
  await expect(bobStrings()).toBeChecked();

  // Revert.
  await Promise.all([savePatch(), bobStrings().uncheck()]);
  await page.reload();
  await pickSunday();
  await expect(bobStrings()).not.toBeChecked();
});

test("Slack member id entry is gated on the org having Slack connected", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  const bobCard = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" });

  // The seed org hasn't installed the Slack bot. A member's id belongs to a
  // specific workspace and is only useful once that bot exists (after which we
  // auto-resolve ids by email), so the manual-entry affordance is hidden until
  // the org connects Slack — no "Set Slack ID" and no edit control.
  await expect(
    bobCard().getByRole("button", { name: /Set Slack ID/ })
  ).toHaveCount(0);
  await expect(
    bobCard().getByRole("button", { name: "Edit Slack member ID" })
  ).toHaveCount(0);
});

test("admin removes a person from a team via the chip's x", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  const savePatch = () =>
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/admin/users/") &&
        r.request().method() === "PATCH"
    );
  const bobCard = () =>
    page.getByRole("listitem").filter({ hasText: "Bob Baker" });
  // Bob is on the Sunday Team (seed) — his card shows a chip with a remove x.
  const removeBtn = bobCard().getByRole("button", {
    name: "Remove Bob Baker from Sunday Team",
  });

  await expect(removeBtn).toBeVisible();
  await Promise.all([savePatch(), removeBtn.click()]);

  // The chip's remove control is gone once he's off the team; it persists.
  await expect(removeBtn).toHaveCount(0);
  await page.reload();
  await expect(
    bobCard().getByRole("button", { name: "Remove Bob Baker from Sunday Team" })
  ).toHaveCount(0);

  // Revert via the card's "+ Add to team" chip so the shared seed is untouched.
  // The picker's panel is portalled to <body>, so its item is looked up on the
  // page — by its full "Add <person> to <team>" name, since every card lists
  // the same team names.
  await bobCard().getByText("+ Add to team").click();
  await Promise.all([
    savePatch(),
    page.getByRole("button", { name: "Add Bob Baker to Sunday Team" }).click(),
  ]);
  await page.reload();
  await expect(
    bobCard().getByRole("button", { name: "Remove Bob Baker from Sunday Team" })
  ).toBeVisible();
});

test("admin opens the Team Activity log", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  await page.getByRole("button", { name: "Team Activity" }).click();
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("heading", { name: "Team Activity" })
  ).toBeVisible();
  // The activity-type filter is present (the log itself may be empty).
  await expect(modal.getByLabel("Activity")).toBeVisible();
});

test("admin opens the team management modal from the Teams card", async ({ page }) => {
  await login(page, "admin");
  await page.goto("/users");

  // The Teams card lists each team as a clickable button (name + member count).
  await page
    .getByRole("button", { name: /Sunday Team\s*\d+ members/ })
    .click();

  // It opens the same shared modal the Org settings page uses.
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("heading", { name: "Sunday Team" })).toBeVisible();
  await expect(modal.getByText(/Members \(\d+\)/)).toBeVisible();
  await expect(modal.getByLabel("Add member")).toBeVisible();
  await expect(modal.getByRole("button", { name: "Delete team" })).toBeVisible();

  await modal.getByRole("button", { name: "Done" }).click();
  await expect(modal).not.toBeVisible();
});

test("admin reorders a team's roles by dragging, and the order sticks", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/users");
  await page.getByRole("button", { name: /Prayer Room Team\s*\d+ members/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByText(/Roles \(\d+\)/)).toBeVisible();

  // The name boxes, in list order — which IS the saved `order`.
  const orderNow = () =>
    modal
      .getByLabel("Role name")
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  // The same order as the SERVER has it, so persistence is checked against the
  // database rather than against a re-render of the page that just saved it.
  const savedOrder = async () => {
    const teams = (await (await page.request.get("/api/teams")).json()) as {
      name: string;
      roles: { label: string }[];
    }[];
    return teams.find((t) => t.name === "Prayer Room Team")!.roles.map((r) => r.label);
  };

  // The team's catalog as the server has it — its id for the restore below, and
  // its roles as the reference order.
  const team = (
    (await (await page.request.get("/api/teams")).json()) as {
      id: string;
      name: string;
      roles: { key: string; label: string; defaultCount: number; adminOnly: boolean }[];
    }[]
  ).find((t) => t.name === "Prayer Room Team")!;

  const before = await orderNow();
  expect(before).toEqual(team.roles.map((r) => r.label));
  expect(before.length).toBeGreaterThan(1);
  const swapped = [before[1], before[0], ...before.slice(2)];

  // Drag one row's grip onto another's. Done with real pointer events, in
  // steps: dnd-kit's pointer sensor only activates after ~5px of movement, and
  // it needs several moves to decide the row has passed its neighbour.
  const grip = (label: string) =>
    modal.getByRole("button", { name: `Drag ${label} to reorder` });
  const dragOnto = async (label: string, target: string) => {
    const from = (await grip(label).boundingBox())!;
    const to = (await grip(target).boundingBox())!;
    const x = from.x + from.width / 2;
    const startY = from.y + from.height / 2;
    const goingUp = to.y < from.y;
    // Overshoot past the target's centre in the direction of travel: dnd-kit
    // swaps two rows once the dragged one passes its neighbour's midpoint, so
    // stopping exactly ON the midpoint is a coin flip.
    const endY = to.y + to.height / 2 + (goingUp ? -8 : 8);

    await page.mouse.move(x, startY);
    await page.mouse.down();
    // Clear the sensor's activation distance first, in the same direction.
    await page.mouse.move(x, startY + (goingUp ? -12 : 12), { steps: 4 });
    await page.mouse.move(x, endY, { steps: 12 });
    await page.mouse.up();
  };

  await dragOnto(before[0], before[1]);
  await expect.poll(orderNow).toEqual(swapped);

  await modal.getByRole("button", { name: "Save roles" }).click();
  await expect.poll(savedOrder).toEqual(swapped);

  // Put the seed order back for the rest of the suite. Done through the API,
  // not a second drag: the drag is what this test is about, and re-testing it
  // as cleanup would only add a way for the cleanup to fail. The catalog is
  // sent back exactly as it was read — position is the order, so replaying the
  // original list restores it without inventing anything.
  const restored = await page.request.put(`/api/teams/${team.id}/roles`, {
    data: { roles: team.roles },
  });
  expect(restored.ok()).toBeTruthy();
  await expect.poll(savedOrder).toEqual(before);
});

// Note: per-set auto group chats are configured on the set/template now (see the
// set detail modal and the recurring-set form), not on the team, so there's no
// team-level lead-time control here anymore.

// The cog menu's "Edit details" — for now the display name, which is a User
// field (global to the person), not a per-org one. Renaming has to survive a
// reload and re-sort the list, since the page is ordered by name.
test("admin renames a member from the cog menu's Edit details", async ({
  page,
}) => {
  await login(page, "admin");
  await page.getByRole("button", { name: "Admin", exact: true }).hover();
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page.getByRole("heading", { name: "Team" })).toBeVisible();

  const openDetailsFor = async (name: string) => {
    await page.getByLabel(`Settings for ${name}`).click();
    await page.getByRole("button", { name: "Edit details" }).click();
  };

  await openDetailsFor("Bob Baker");
  // The modal names the person and says what they sign in as — the reassurance
  // that a rename doesn't move their login.
  await expect(page.getByRole("heading", { name: "Edit Bob Baker" })).toBeVisible();
  await expect(page.getByText("bob", { exact: true })).toBeVisible();

  // A blank name is refused, and the modal stays open to say so.
  await page.getByLabel("Name").fill("   ");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Name is required.")).toBeVisible();

  await page.getByLabel("Name").fill("Robert Baker");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Bob Baker" })
  ).not.toBeVisible();

  // Reload to prove it was persisted server-side, not just local state.
  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Robert Baker" })
  ).toBeVisible();
  await expect(page.getByText("Bob Baker")).not.toBeVisible();

  // Revert, so the rest of the suite still finds "Bob Baker".
  await openDetailsFor("Robert Baker");
  await page.getByLabel("Name").fill("Bob Baker");
  await page.getByRole("button", { name: "Save" }).click();
  await page.reload();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Bob Baker" })
  ).toBeVisible();
});
