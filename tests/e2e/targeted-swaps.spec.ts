// E2E: the targeted-swap ("trade") workflow between two people who play the
// same role on the same team but different upcoming sets. erin and omar are
// both on Electric Guitar for the Sunday Team (erin on Sunday Morning, omar on
// the Sunday Morning two weeks out), and nothing else in the suite touches
// them — so the trade is deterministic (erin has exactly one candidate: omar).
//
//   erin proposes to trade her set for omar's → both freeze at "Pending swap"
//   → omar sees it in Cover Requests and accepts → both slots swap owners and
//   land Confirmed. Finally we assert the team-stats counts moved: erin's
//   "swaps requested" +1 and omar's "swaps taken" +1.
import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

// Wide window covering every seeded set.
const START = "2026-07-01T00:00:00.000Z";
const END = "2026-12-31T23:59:59.999Z";

type UserStats = {
  swapsRequested: number;
  swapsTaken: number;
  coversRequested: number;
  coversTaken: number;
};

// Read one user's team-stats bundle via the admin API. Must be called while
// logged in as an admin of the (first/oldest) org.
async function statsFor(page: Page, username: string): Promise<UserStats> {
  const orgs = (await (await page.request.get("/api/orgs")).json()) as {
    id: string;
    isAdmin: boolean;
  }[];
  const adminOrg = orgs.find((o) => o.isAdmin);
  expect(adminOrg, "admin has no admin org").toBeTruthy();
  const headers = { "x-org-id": adminOrg!.id };

  const users = (await (
    await page.request.get("/api/admin/users", { headers })
  ).json()) as { id: string; username: string }[];
  const user = users.find((u) => u.username === username);
  expect(user, `no user "${username}"`).toBeTruthy();

  const stats = (await (
    await page.request.get(
      `/api/admin/users/stats?start=${START}&end=${END}`,
      { headers }
    )
  ).json()) as Record<string, UserStats>;
  return (
    stats[user!.id] ?? {
      swapsRequested: 0,
      swapsTaken: 0,
      coversRequested: 0,
      coversTaken: 0,
    }
  );
}

test("targeted swap: erin trades her set to omar; both confirm; stats update", async ({
  page,
}) => {
  // ── Baseline the two stats we expect to move (as admin). ────────────────
  await login(page, "admin");
  const erinBefore = (await statsFor(page, "erin")).swapsRequested;
  const omarBefore = (await statsFor(page, "omar")).swapsTaken;

  // ── erin proposes the trade. ────────────────────────────────────────────
  await login(page, "erin");
  await page.goto("/swaps");
  const erinCard = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Electric Guitar" })
    .first();
  await expect(erinCard).toBeVisible();
  await erinCard.getByRole("button", { name: "Swap", exact: true }).click();

  // The one-step picker: erin's only candidate is omar's Sunday Morning set.
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("heading", { name: "Swap this set" })
  ).toBeVisible();
  const omarRow = modal.locator("div.rounded-lg").filter({ hasText: "Omar Osei" });
  await expect(omarRow).toBeVisible();
  await omarRow.getByRole("button", { name: "Request swap" }).click();

  // Modal closes and erin's slot is now frozen mid-trade (she can cancel).
  await expect(erinCard.getByText("Pending swap")).toBeVisible();
  await expect(
    erinCard.getByRole("button", { name: "Cancel swap" })
  ).toBeVisible();

  // ── omar accepts from his Cover Requests. ───────────────────────────────
  await login(page, "omar");
  await page.goto("/swaps");
  const incoming = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(incoming).toBeVisible();
  await incoming.getByRole("button", { name: "Accept" }).click();

  // omar now holds a confirmed Sunday Morning Electric Guitar slot (erin's old
  // one). The proposal card is gone.
  const omarCard = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Electric Guitar" })
    .first();
  await expect(omarCard.getByText("Confirmed")).toBeVisible();
  await expect(page.getByText("Erin Evans")).toHaveCount(0);

  // ── Stats moved: erin requested one swap, omar took (accepted) one. ──────
  await login(page, "admin");
  expect((await statsFor(page, "erin")).swapsRequested).toBe(erinBefore + 1);
  expect((await statsFor(page, "omar")).swapsTaken).toBe(omarBefore + 1);
});
