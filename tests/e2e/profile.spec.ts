// E2E: profile editing — teams, and the READ-ONLY view of the per-team roles a
// user can be scheduled for. Both are the org admin's to set from the Team tab:
// a plain member sees no join/leave controls, an admin manages their own.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test("a user sees their per-team roles but can't change them", async ({ page }) => {
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // Roles are per-team: pick Carol's team first.
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });

  // Her roles are listed as plain chips, not offered as checkboxes, and a role
  // she doesn't play (Strings) isn't shown at all.
  const roles = page.getByTestId("profile-roles");
  await expect(roles).toContainText("Keys");
  // The team calls VOCALS "Vox" — the chips use the team's own labels.
  await expect(roles).toContainText("Vox");
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

test("a member can't add or remove themselves from a team", async ({ page }) => {
  // Team membership is an org admin's call, so a plain member gets neither
  // control — the panel is a read-only list of where they already serve.
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });
  await expect(page.getByRole("button", { name: "Add a team" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Leave this team" })).toHaveCount(0);
});

test("not even an admin can add themselves to a team from their profile", async ({
  page,
}) => {
  // Adding anyone to a team — yourself included — happens in the Team tab, so
  // the profile panel offers no way in. Leaving is the one write left, and an
  // admin of the team's org keeps it.
  await login(page, "admin");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Add a team" })).toHaveCount(0);
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });
  await expect(page.getByRole("button", { name: "Leave this team" })).toBeVisible();
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
  // The field saves on blur, not on every keystroke — so typing alone isn't a
  // write, and the test has to leave the field the way a person would.
  await email.fill("carol.e2e@example.com");
  await email.blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  // Let any (unwanted) trailing requests land before asserting.
  await page.waitForTimeout(500);

  expect(calls.filter((c) => c === "PUT /api/me")).toHaveLength(1);
  expect(calls).not.toContain("POST /api/auth/session");
  expect(calls).not.toContain("GET /api/orgs");
  expect(calls).not.toContain("GET /api/availability-request");

  // Revert so the suite's shared state is unchanged.
  await email.fill(original);
  await email.blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
});
