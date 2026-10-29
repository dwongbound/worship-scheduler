// E2E: login flow + route protection.
import { type Page, expect, test } from "@playwright/test";
import { attemptTag, login, orgKey } from "./helpers";
import { CONTACT_EMAIL } from "../../lib/legal";

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
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(secondEmail);
});

// Login strategy 2: Google SSO. A true end-to-end run needs real OAuth
// credentials (GOOGLE_CLIENT_ID/SECRET) plus a mock OAuth server to drive the
// consent redirect, so it's skipped in CI. The find-or-create-by-email
// linking lives in lib/auth.ts's signIn/jwt callbacks.
test.skip("signs in with Google (needs OAuth credentials + mock)", () => {});

// The two public pages: Google's OAuth verification fetches them with no
// account, so a redirect to /login here would fail the review.
test("the privacy policy and terms are readable signed out, and linked from sign in", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Privacy Policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
  // The Google-specific promise Google looks for.
  await expect(page.getByText("API Services User Data Policy")).toBeVisible();

  // The pair link to each other, and back to signing in.
  await page.getByRole("link", { name: "Terms of Service" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/login/);

  // And straight to the URL, as Google fetches it: no bounce to /login.
  await page.goto("/privacy");
  await expect(page).toHaveURL(/\/privacy$/);
});

// The home page is the third public page, and the one Google's verification
// judges the app's name and logo by. It failed review as a login wall, so
// what matters here is that a stranger reaching "/" is NOT bounced.
test("the home page is readable signed out, naming TapWorship", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: /playing Sunday/ })
  ).toBeVisible();
  // The name as the consent screen spells it, and the mark beside it — the
  // two things the review compares.
  await expect(page.getByText("TapWorship", { exact: true }).first()).toBeVisible();
  await expect(page.getByAltText("TapWorship").first()).toBeVisible();
  // And a way on to each of the pages a review expects to find linked.
  await expect(page.getByRole("link", { name: "Privacy Policy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Terms of Service" })).toBeVisible();
  // The header's Sign in is the way IN for someone who already has an account.
  await page.getByRole("link", { name: "Sign in" }).first().click();
  await expect(page).toHaveURL(/\/login/);
});

// With the script, the sections below the fold start hidden and arrive as you
// reach them. Anything that reaches the bottom of the page must end up visible
// — a reveal that never fires is content nobody can read.
test("the home page's sections arrive as you scroll, and all of them arrive", async ({
  page,
}) => {
  await page.goto("/");
  const contact = page.getByRole("heading", { name: "Get your organization started" });

  await page.getByRole("link", { name: "Get started" }).click();
  await expect(contact).toBeVisible();
  await expect(contact).toHaveCSS("opacity", "1");

  // The roster card's rows stagger in from the card's own reveal rather than
  // one of their own — so they are the rows most easily left hidden, which is
  // an empty card beside the headline.
  await expect(page.getByText("Lena Okafor")).toHaveCSS("opacity", "1");
  await expect(page.getByText("Nobody yet")).toHaveCSS("opacity", "1");

  // Every revealed block on the page, once it has been scrolled past.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const revealed = page.locator(".reveal");
  const count = await revealed.count();
  expect(count).toBeGreaterThan(5);
  for (let i = 0; i < count; i++) {
    await expect(revealed.nth(i)).toHaveClass(/is-in/);
  }
});

// The two call-to-action buttons point at different people, and swapping them
// is the easy mistake: there is no self-serve sign-up, so "Get started" that
// lands on /login strands the very person it is for.
test("the home page's Get started goes to the contact block, not the login", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Get started" }).click();
  // Still on the home page, and at the section that tells them what to do.
  await expect(page).toHaveURL(/\/#contact$/);
  await expect(
    page.getByRole("heading", { name: "Get your organization started" })
  ).toBeInViewport();
  // The sign-in route stays available beside it, for someone who has an account.
  await expect(
    page.getByRole("link", { name: "Sign in" }).first()
  ).toHaveAttribute("href", "/login");
});

// The page's one call to action for someone with NO account: the address is
// on the page as text (a copy can be refused and the page can't tell), and the
// button reports what it did in its own label.
test("the home page offers the contact address as text and as a copy button", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(page.getByText(CONTACT_EMAIL, { exact: true })).toBeVisible();

  const copy = page.getByRole("button", { name: "Copy email" });
  await expect(copy).toBeVisible();
  await copy.click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    CONTACT_EMAIL
  );
});

// Signed in, "/" still means "the app" — Google's own sign-in callback lands
// there, and landing on marketing copy after signing in would read as broken.
test("a signed-in visitor to the home page gets the app, not the marketing page", async ({
  page,
}) => {
  await login(page, "bob");
  await page.goto("/");
  await expect(page).toHaveURL(/\/calendar/);
  await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
});

// The login page got the home page's arrival motion (Dylan's ask). The rule is
// the same one that governs the home page: the card must READ with the motion
// off, so these two tests are the no-motion path and the motion path.
test("the login card arrives, and is plainly there with motion turned off", async ({
  page,
}) => {
  // Someone who asked their system for less motion gets no attribute at all,
  // so every `.reveal` renders exactly as the markup has it. This is also the
  // state a crawler and a blocked bundle see.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "TapWorship" })).toBeVisible();
  await expect(page.locator("html")).not.toHaveAttribute("data-reveal", "on");
  const card = page.locator(".reveal").first();
  await expect(card).toHaveCSS("opacity", "1");
  // The form is a staggered child of the card, which is the part most easily
  // left at opacity 0 — an empty card with nothing to sign in with.
  await expect(page.getByLabel("Username / Email")).toBeVisible();
  await expect(page.locator("form")).toHaveCSS("opacity", "1");
});

test("the login card and its rows all finish arriving", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-reveal", "on");

  const card = page.locator(".reveal").first();
  await expect(card).toHaveClass(/is-in/);
  await expect(card).toHaveCSS("opacity", "1");

  // Every direct child of the staggered card, not just the first. They start
  // hidden and are released by a rule keyed on the CARD's `is-in`, so one that
  // never gets released is an empty card with nothing to sign in with.
  const rows = page.locator(".reveal-stagger > *");
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    await expect(rows.nth(i)).toHaveCSS("opacity", "1");
  }
});
