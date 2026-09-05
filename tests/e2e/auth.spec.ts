// E2E: login flow + route protection.
import { type Page, expect, test } from "@playwright/test";
import { attemptTag, login, orgKey } from "./helpers";

test("redirects unauthenticated visitors to the login page", async ({ page }) => {
  await page.goto("/calendar");
  await expect(page).toHaveURL(/\/login/);
});

test("rejects a bad password", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username / Email").fill("bob");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test("signs in with valid credentials and lands on the calendar", async ({ page }) => {
  await login(page, "bob");
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  // Navbar shows the user's name.
  await expect(page.getByText("Bob Baker")).toBeVisible();
});

test("logs out via the user dropdown", async ({ page }) => {
  await login(page, "bob");
  await page.getByText("Bob Baker").click(); // open the avatar dropdown
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/);
});

test("crossing the /login boundary raises no React error (hooks-order regression)", async ({
  page,
}) => {
  // The Navbar is mounted on every route but renders null on /login and /join.
  // A hook once sat *below* that early return, so React threw "Rendered fewer
  // hooks than expected" when the persistent Navbar re-rendered across the
  // boundary (e.g. on logout). Fail loudly if any uncaught error comes back.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page, "bob"); // /login → /calendar (Navbar gains its chrome)
  await page.getByText("Bob Baker").click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login/); // /calendar → /login (Navbar → null)

  expect(errors).toEqual([]);
});

// Login strategy 1: self-service sign-up (credentials). A brand-new account
// has no org membership, so it's gated at /join until it redeems an org key;
// a bad key is rejected, the real one lands on the calendar, signed in.
test("signs up a new account, joins an org by key, and lands on the calendar", async ({
  page,
}) => {
  await page.goto("/login");
  // Switch to the sign-up form via the bottom toggle.
  await page.getByRole("button", { name: "Sign up" }).click();

  await page.getByLabel("First name").fill("New");
  await page.getByLabel("Last name").fill("Member");
  await page.getByLabel("Email").fill("new.member@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  // Submit (the form's own "Sign up" button).
  await page.getByRole("button", { name: "Sign up" }).click();

  // No memberships yet → the org-key gate, with no app chrome around it.
  await expect(page).toHaveURL(/\/join/);
  await expect(
    page.getByRole("heading", { name: "Join your organization" })
  ).toBeVisible();

  // A wrong key is rejected in place…
  await page.getByLabel("Organization key").fill("not-a-real-key");
  await page.getByRole("button", { name: "Join" }).click();
  await expect(
    page.getByText("That key doesn't match any organization")
  ).toBeVisible();

  // …the real key gets us in.
  await page.getByLabel("Organization key").fill(orgKey(0));
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await expect(page.getByText("New Member")).toBeVisible(); // navbar name
});

// Sign-up guards against a mistyped password: the confirm field must match.
test("blocks sign-up when the passwords don't match", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();

  await page.getByLabel("First name").fill("Mismatch");
  await page.getByLabel("Last name").fill("User");
  await page.getByLabel("Email").fill("mismatch@example.com");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("different456");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page.getByText("Passwords don't match.")).toBeVisible();
  await expect(page).toHaveURL(/\/login/); // stayed put, no account created
});

// ── Duplicate-name warning ────────────────────────────────────────────────
// Signing up under a name that already has an account is almost always the same
// person on a second address, which would split their history across two rows.
// We warn once, naming the account we found, and let them pick either way.
//
// Both tests build their own "first account" rather than leaning on the seed:
// seeded users have no email, and the warning only reports accounts it can
// actually send you to.

/**
 * Sign up one account and leave the browser signed out again, ready for the
 * next sign-up. Stops at /join — a brand-new account has no org — which is
 * proof enough that the account was created.
 */
async function signUpFresh(
  page: Page,
  first: string,
  last: string,
  email: string
) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("First name").fill(first);
  await page.getByLabel("Last name").fill(last);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/join/);
  await page.context().clearCookies();
}

test("warns that an account with this name exists, and offers to sign in as it", async ({
  page,
}, testInfo) => {
  const tag = attemptTag(testInfo);
  const firstName = `Dana${tag}`;
  await signUpFresh(page, firstName, "Doyle", `dana${tag}.doyle@example.com`);

  // Same human, second address — exactly the case the warning exists for.
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill("Doyle");
  await page.getByLabel("Email").fill(`dana${tag}.doyle@work.example.com`);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();

  // The popup names the account it found — both halves, since the email is the
  // actionable part.
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "An account with this name already exists",
    })
  ).toBeVisible();
  await expect(dialog.getByText(`${firstName} Doyle`)).toBeVisible();
  await expect(
    dialog.getByText(`dana${tag}.doyle@example.com`)
  ).toBeVisible();

  // "That's me" hands them to the sign-in form with that address filled in.
  await dialog
    .getByRole("button", { name: "That's me — sign in with that email" })
    .click();
  await expect(page.getByLabel("Username / Email")).toHaveValue(
    `dana${tag}.doyle@example.com`
  );
  // And it really is that account's password — no second row was created.
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/join/);
});

test("signs up a namesake anyway when told it's a different person", async ({
  page,
}, testInfo) => {
  const tag = attemptTag(testInfo);
  const firstName = `Evan${tag}`;
  await signUpFresh(page, firstName, "Ellis", `evan${tag}.ellis@example.com`);

  await page.goto("/login");
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.getByLabel("First name").fill(firstName);
  await page.getByLabel("Last name").fill("Ellis");
  const secondEmail = `evan${tag}.ellis2@example.com`;
  await page.getByLabel("Email").fill(secondEmail);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByLabel("Confirm password").fill("password123");
  await page.getByRole("button", { name: "Sign up" }).click();

  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "An account with this name already exists",
    })
  ).toBeVisible();

  // Overriding it goes through: two people really can share a name.
  await dialog
    .getByRole("button", { name: "This is someone else — continue" })
    .click();
  await expect(page).toHaveURL(/\/join/);

  // Signed in as the SECOND account, not the first — the override created a
  // genuinely new row rather than resolving to the namesake.
  await page.getByLabel("Organization key").fill(orgKey(0));
  await page.getByRole("button", { name: "Join" }).click();
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
  await page.goto("/profile");
  await expect(page.getByLabel("Email")).toHaveValue(secondEmail);
});

// Login strategy 2: Google SSO. A true end-to-end run needs real OAuth
// credentials (GOOGLE_CLIENT_ID/SECRET) plus a mock OAuth server to drive the
// consent redirect, so it's skipped in CI. The find-or-create-by-email
// linking lives in lib/auth.ts's signIn/jwt callbacks.
test.skip("signs in with Google (needs OAuth credentials + mock)", () => {});
