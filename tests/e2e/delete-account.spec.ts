// E2E: deleting your own account — from /profile, and through the API the iOS
// app uses. Each test makes its own throwaway account (with an org key, so it
// can sign into the app), because deleting a seeded person
// would change what every other spec sees.
import { type APIRequestContext, expect, test } from "@playwright/test";
import { login, orgKey } from "./helpers";

async function freshAccount(request: APIRequestContext, tag: string) {
  const email = `delete-me-${tag}-${Date.now()}@example.com`;
  const res = await request.post("/api/signup", {
    data: {
      firstName: "Delete",
      lastName: `Me ${tag}${Date.now()}`,
      email,
      password: "password123",
      allowDuplicateName: true,
    },
  });
  expect(res.ok()).toBe(true);
  // Join an org (through the app's own bearer door), so signing in lands in
  // the app rather than at /join.
  const { token } = await (
    await request.post("/api/mobile/session", { data: { username: email, password: "password123" } })
  ).json();
  const joined = await request.post("/api/orgs/join", {
    headers: { Authorization: `Bearer ${token}` },
    data: { key: orgKey(0) },
  });
  expect(joined.ok()).toBe(true);
  return email;
}

test("deleting from /profile asks for DELETE, then the account is gone", async ({
  page,
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const email = await freshAccount(api, "web");
  await login(page, email);
  await page.goto("/profile");

  await page.getByRole("button", { name: "Delete account" }).click();
  const modal = page.getByTestId("delete-account-modal");
  await expect(modal.getByText("This can’t be undone.")).toBeVisible();
  const confirm = page.getByRole("button", { name: "Delete my account forever" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("delete");
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // Signed out and back on the public home page…
  await expect(page).toHaveURL(/\/$/);
  // …and the account no longer signs in anywhere.
  const again = await api.post("/api/mobile/session", {
    data: { username: email, password: "password123" },
  });
  expect(again.status()).toBe(401);
  await api.dispose();
});

test("the API refuses without the phrase, then deletes and signs the token out", async ({
  playwright,
  baseURL,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const email = await freshAccount(api, "api");
  const { token } = await (
    await api.post("/api/mobile/session", { data: { username: email, password: "password123" } })
  ).json();
  const auth = { Authorization: `Bearer ${token}` };

  const unconfirmed = await api.delete("/api/me", { headers: auth, data: {} });
  expect(unconfirmed.status()).toBe(400);
  expect((await api.get("/api/me", { headers: auth })).status()).toBe(200);

  const done = await api.delete("/api/me", { headers: auth, data: { confirm: "DELETE" } });
  expect(done.status()).toBe(200);
  // The token is still cryptographically valid, but names no one now.
  expect((await api.get("/api/me", { headers: auth })).status()).toBe(401);
  await api.dispose();
});
