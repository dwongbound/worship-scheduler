// E2E: profile editing — teams, and the READ-ONLY view of the per-team roles a
// user can be scheduled for. Both are the org admin's to set from the Team tab:
// nobody — member or admin — gets a join/leave control here.
import { expect, test } from "@playwright/test";
import { login } from "./helpers";
import { INVITE_OTHER_VALUE } from "@/lib/invitePicker";

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

test("not even an admin can join or leave a team from their profile", async ({
  page,
}) => {
  // Team membership — yours included — is only ever changed from the Team tab,
  // so this panel offers no way in OR out, whoever is looking at it.
  await login(page, "admin");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  await expect(page.getByRole("button", { name: "Add a team" })).toHaveCount(0);
  await page.getByTestId("profile-team-select").selectOption({ label: "Sunday Team" });
  await expect(page.getByRole("button", { name: "Leave this team" })).toHaveCount(0);
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

test("with Google Calendar connected, a member with no email is asked for one on their profile", async ({
  page,
}) => {
  // No test org has a real Google account, so mark Carol's orgs connected on
  // the way out of GET /api/me — that flag is all /profile reads.
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    for (const m of body.memberships ?? []) m.orgGoogleCalendarConnected = true;
    await route.fulfill({ response: res, json: body });
  });
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  const email = page.getByLabel("Email");
  const original = await email.inputValue();
  const banner = page.getByTestId("profile-calendar-banner");
  // Seeded users have no email, so the banner shows until one is saved.
  if (!original) await expect(banner).toContainText("calendar invite");

  await email.fill("carol.cal@example.com");
  await email.blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await expect(banner).toHaveCount(0);

  // With an address to invite, the switch takes the banner's place: on by
  // default, and saying where the invites go.
  const invites = page
    .getByTestId("profile-calendar-invites")
    .getByLabel("Calendar invites for my sets");
  await expect(invites).toBeChecked();

  // Where they go is the person's to choose, because Google decides which
  // calendar an invite lands on from the address it was sent to. Blank means
  // the email above; an address moves the sets onto that calendar.
  const sendTo = page.getByLabel("Send invites to");
  await expect(sendTo).toHaveValue("");
  await expect(sendTo).toHaveAttribute("placeholder", "carol.cal@example.com");
  await sendTo.fill("not an address");
  await sendTo.blur();
  await expect(page.getByText(/doesn’t|doesn't/)).toBeVisible();
  // A refused address is rolled back, so the field never shows something the
  // server didn't take.
  await expect(sendTo).toHaveValue("");

  await sendTo.fill("sets@group.calendar.google.com");
  await sendTo.blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Send invites to")).toHaveValue(
    "sets@group.calendar.google.com"
  );
  // Clearing it hands the invites back to the account email.
  await page.getByLabel("Send invites to").fill("");
  await page.getByLabel("Send invites to").blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();

  // Opting out asks about the invites already on their calendar. The
  // preference saves either way, so dismissing the question can't leave the
  // box disagreeing with the db.
  await invites.uncheck();
  const withdraw = page.getByRole("dialog");
  await expect(withdraw).toContainText("already sent");
  await withdraw.getByRole("button", { name: "Leave them" }).click();
  await expect(withdraw).toHaveCount(0);
  await expect(page.getByText("You're still on the roster")).toBeVisible();
  await page.reload();
  await expect(
    page.getByTestId("profile-calendar-invites").getByLabel("Calendar invites for my sets")
  ).not.toBeChecked();

  // And the other answer: re-opting in, then out again with a yes, which is
  // what asks the server to drop them from those events.
  const again = page
    .getByTestId("profile-calendar-invites")
    .getByLabel("Calendar invites for my sets");
  await again.check();
  await again.uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "Remove me" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(again).not.toBeChecked();

  // Back on, then clear the email — which restores the seed state and brings
  // the banner back, the switch having nowhere to send anything.
  await page
    .getByTestId("profile-calendar-invites")
    .getByLabel("Calendar invites for my sets")
    .check();
  await email.fill(original);
  await email.blur();
  await expect(page.getByTestId("profile-calendar-invites")).toHaveCount(0);
  if (!original) await expect(banner).toBeVisible();
});

test("the invite address can be picked from your own Google calendars", async ({
  page,
}) => {
  // Same trick as the test above: no test org has a real Google account, so
  // mark Carol's orgs connected on the way out of GET /api/me.
  await page.route("**/api/me", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const body = await res.json();
    for (const m of body.memberships ?? []) m.orgGoogleCalendarConnected = true;
    await route.fulfill({ response: res, json: body });
  });
  // And no test account has given Google permission to list its calendars, so
  // stand in for that list. The picker's own shape is what's under test here;
  // reading it from Google is lib/googleAvailability's job.
  await page.route("**/api/google-calendar/my-calendars", async (route) => {
    await route.fulfill({
      json: {
        calendars: [
          { id: "carol.pick@example.com", name: "carol.pick@example.com", primary: true },
          { id: "sets@group.calendar.google.com", name: "Worship sets", primary: false },
        ],
      },
    });
  });

  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  // The invite settings only exist once there's an address to invite. Waiting
  // on the section rather than the "Saved" flash keeps this step honest on a
  // re-run, where the email may already be what we're setting it to.
  const email = page.getByLabel("Email");
  const original = await email.inputValue();
  await email.fill("carol.pick@example.com");
  await email.blur();
  await expect(page.getByTestId("profile-calendar-invites")).toBeVisible();

  // With a list to offer, "Send invites to" is a picker rather than a box.
  // Located by test id: the select's accessible name takes in its option text,
  // one of which is "Another address…", so a label lookup for the box below
  // would match the select too.
  const picker = page.getByTestId("invite-calendar");
  await expect(picker).toBeVisible();
  // The account's own calendar leads; the primary calendar is NOT listed again
  // under its own name, since its address IS that email.
  await expect(picker).toContainText("carol.pick@example.com");
  await expect(picker).toContainText("Worship sets");
  // Start from the default however an earlier run left it.
  await picker.selectOption({ value: "" });
  await page.reload();
  await expect(page.getByTestId("invite-calendar")).toHaveValue("");

  // Picking a calendar saves its address — which is how Google is told where
  // to put the event, there being no other way to choose a calendar.
  await page.getByTestId("invite-calendar").selectOption({ label: "Worship sets" });
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("invite-calendar")).toHaveValue(
    "sets@group.calendar.google.com"
  );

  // The address box is still there as the way out of the list — a calendar
  // someone else owns, or another account's, is never in it.
  await page.getByTestId("invite-calendar").selectOption({ value: INVITE_OTHER_VALUE });
  const box = page.getByTestId("invite-address");
  await expect(box).toBeVisible();
  await box.fill("elsewhere@example.com");
  await box.blur();
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await page.reload();
  // A saved address the list can't offer keeps its own option, so the picker
  // shows what is actually in force rather than quietly reading as the default.
  await expect(page.getByTestId("invite-calendar")).toHaveValue(
    "elsewhere@example.com"
  );

  // Back to the default, and restore the seed state.
  await page.getByTestId("invite-calendar").selectOption({ value: "" });
  await expect(page.getByTestId("profile-saved")).toBeVisible();
  await email.fill(original);
  await email.blur();
});

test("the invite settings are mine to set before any org connects a calendar", async ({
  page,
}) => {
  // No /api/me mock here, deliberately: no test org has connected Google
  // Calendar, which is the state under test. Whether I want these invites, and
  // which of my own calendars they land on, is my answer to give — waiting on
  // an admin to connect would mean the first invite could arrive before I had
  // the chance to say no to it.
  await login(page, "carol");
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Edit Profile" })).toBeVisible();

  const email = page.getByLabel("Email");
  const original = await email.inputValue();
  await email.fill("carol.nogcal@example.com");
  await email.blur();

  const invites = page
    .getByTestId("profile-calendar-invites")
    .getByLabel("Calendar invites for my sets");
  await expect(invites).toBeVisible();
  await expect(invites).toBeChecked();
  // And it says why nothing is arriving yet, rather than looking broken.
  await expect(page.getByText("sends calendar invites yet")).toBeVisible();

  // The answer sticks, so it's in force the moment an org does connect.
  await invites.uncheck();
  await page.getByRole("dialog").getByRole("button", { name: "Leave them" }).click();
  await page.reload();
  await expect(
    page.getByTestId("profile-calendar-invites").getByLabel("Calendar invites for my sets")
  ).not.toBeChecked();

  // Put the seed state back.
  await page
    .getByTestId("profile-calendar-invites")
    .getByLabel("Calendar invites for my sets")
    .check();
  await email.fill(original);
  await email.blur();
});
