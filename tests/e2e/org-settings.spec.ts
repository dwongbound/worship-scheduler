// E2E: the Org settings page (/orgs) — an org admin changing and rotating
// their org's join key. Seed facts: paul administers BOTH orgs, so he can open
// org 2's settings. The test mutates org 2's key but RESTORES the seeded value
// at the end, so the sibling "join by key" spec (which redeems orgKey(1)) still
// passes regardless of file order.
import { expect, test } from "@playwright/test";
import { login, orgKey } from "./helpers";

// Org names come from env/test.env's ORG_KEYS ("Name:key,Name:key").
function orgName(index: number): string {
  const entry = (process.env.ORG_KEYS ?? "").split(",")[index] ?? "";
  const name = entry.slice(0, entry.lastIndexOf(":")).trim();
  expect(name, `no ORG_KEYS entry at index ${index}`).toBeTruthy();
  return name;
}

test("an org admin can change and rotate the org join key", async ({ page }) => {
  await login(page, "paul"); // login() also suppresses the first-run tour
  await page.goto("/orgs");

  // Pick org 2 in the left rail; its settings (incl. the key) load on the right.
  await page.getByRole("button", { name: orgName(1) }).click();

  const original = orgKey(1);
  const keyField = page.getByLabel("Join key");
  await expect(keyField).toHaveValue(original);

  // Set a custom key and save it.
  const custom = "e2e-rekeyed-123";
  await keyField.fill(custom);
  await page.getByRole("button", { name: "Save key" }).click();

  // Persisted: a fresh load (re-selecting the org) shows the new key.
  await page.reload();
  await page.getByRole("button", { name: orgName(1) }).click();
  await expect(page.getByLabel("Join key")).toHaveValue(custom);

  // The new key redeems (paul is already a member, so this is idempotent — no
  // state pollution) and the old key no longer matches any org.
  const withNew = await page.request.post("/api/orgs/join", {
    data: { key: custom },
  });
  expect(withNew.ok()).toBeTruthy();
  const withOld = await page.request.post("/api/orgs/join", {
    data: { key: original },
  });
  expect(withOld.ok()).toBeFalsy();

  // Rotate mints a fresh random key, replacing the custom one.
  await page.getByRole("button", { name: "Rotate" }).click();
  await expect(page.getByLabel("Join key")).not.toHaveValue(custom);

  // Restore the seeded key so specs that join org 2 by its key still pass.
  await page.getByLabel("Join key").fill(original);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByLabel("Join key")).toHaveValue(original);
});
