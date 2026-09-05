// E2E: profile editing — teams, and the READ-ONLY view of the per-team roles a
// user can be scheduled for (an admin assigns those from the Team tab).
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a user sees their per-team roles but can't change them", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Roles are per-team: pick Carol's team first.
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });

  // Carol plays Keys + Vocals — listed, not offered as checkboxes, and the
  // roles she doesn't play (Strings) aren't shown at all.
  const roles = page.getByTestId("profile-roles");
  await expect(roles).toContainText("Keys");
  await expect(roles).toContainText("Vocals");
  await expect(roles).not.toContainText("Strings");
  await expect(page.getByLabel("Strings")).toHaveCount(0);
});

test("a brand-new member is told to ask an admin for their roles", async ({
  page,
}) => {
  // "newbie" (Noah New) is on the Sunday team but has no roles yet — the
  // onboarding state (needsRoles).
  await login(page, "newbie");

  // Reminder dot on the avatar + a banner explaining why they can't be booked.
  await expect(page.getByTestId("profile-dot")).toBeVisible();
  await expect(
    page.getByText("don’t play any roles on your teams yet")
  ).toBeVisible();

  // The banner links to the profile page, which says who to ask — roles are an
  // admin's to grant, so there's nothing here for the user to check.
  await page.getByRole("link", { name: "Check your profile" }).click();
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });
  await expect(page.getByTestId("profile-roles")).toContainText(
    "ask your org admin"
  );
  await expect(page.getByLabel("Drums")).toHaveCount(0);
});

test("a user joins a team via the Add-a-team modal, then leaves it", async ({
  page,
}) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Carol is on the Sunday Team only, so Prayer Room Team is joinable.
  const teamSelect = page.getByTestId("profile-team-select");
  await expect(teamSelect).not.toContainText("Prayer Room Team");

  await page.getByRole("button", { name: "Add a team" }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Prayer Room Team").check();
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/me/teams/") && r.request().method() === "PUT"
    ),
    modal.getByRole("button", { name: "Add", exact: true }).click(),
  ]);

  // Joined: it's in the dropdown now, and auto-selected (roles panel shows).
  await expect(teamSelect).toContainText("Prayer Room Team");
  await expect(page.getByRole("button", { name: "Leave this team" })).toBeVisible();

  // Leave it to restore the shared seed state.
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes("/api/me/teams/") && r.request().method() === "DELETE"
    ),
    page.getByRole("button", { name: "Leave this team" }).click(),
  ]);
  await expect(teamSelect).not.toContainText("Prayer Room Team");
});

test("an established member sees no profile-setup nudge", async ({ page }) => {
  // Carol already has roles on her team, so neither the dot nor banner appears.
  await login(page, "carol");
  await expect(page.getByTestId("profile-dot")).toHaveCount(0);
  await expect(
    page.getByText("don’t play any roles on your teams yet")
  ).toHaveCount(0);
});

test("a password (non-Google) account can edit its email and password", async ({
  page,
}) => {
  // All seed users are credentials accounts (they have a password), so the
  // email field is editable and the real "Change password" button shows —
  // none of the Google-account locks apply.
  await login(page, "carol");
  await page.goto("/profile");

  await expect(page.getByLabel("Email")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Change password" })).toBeEnabled();
  await expect(page.getByText("Managed by your Google account.")).toHaveCount(0);
  await expect(page.getByText("(signed in with Google)")).toHaveCount(0);
});

test("editing a profile field fires one write and no session/org refetch", async ({
  page,
}) => {
  // Regression guard for the save cascade: an autosaved field should be a single
  // PUT to /api/me plus the one aggregated GET /api/notifications that refreshes
  // the reminder dots — no session refresh, no /api/orgs, no per-badge
  // availability fetch.
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  const calls: string[] = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (url.pathname.startsWith("/api/")) calls.push(`${req.method()} ${url.pathname}`);
  });

  // The email field, not the name: a name change deliberately refreshes the
  // session (the navbar shows it), which would make the assertions below lie.
  const email = page.getByLabel("Email");
  const original = await email.inputValue();
  await email.fill("carol.e2e@example.com");
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  // Let any (unwanted) trailing requests land before asserting.
  await page.waitForTimeout(500);

  expect(calls.filter((c) => c === "PUT /api/me")).toHaveLength(1);
  expect(calls).not.toContain("POST /api/auth/session");
  expect(calls).not.toContain("GET /api/orgs");
  expect(calls).not.toContain("GET /api/availability-request");

  // Revert so the suite's shared state is unchanged.
  await email.fill(original);
  await expect(page.getByTestId("profile-saved")).toBeVisible();
});
