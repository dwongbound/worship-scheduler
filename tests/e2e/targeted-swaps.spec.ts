// E2E: the targeted-swap ("trade") workflow between two people who play the
// same role on the same team but different upcoming sets. erin and omar are
// both on Electric Guitar for the Sunday Team (erin on Sunday Morning, omar on
// the Sunday Morning two weeks out), and nothing else in the suite touches
// them — so the trade is deterministic (erin has exactly one candidate: omar).
//
//   erin proposes to trade her set for omar's → both freeze at "Pending swap"
//   → omar sees it under Covers / Swaps and accepts → both slots swap owners and
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
  // omar's Sunday Morning set specifically — other suite tests (the generate
  // flow) can seat omar on Electric Guitar in extra Thursday Rehearsal sets,
  // which would also match on his name alone, so pin the set label too.
  const omarRow = modal
    .locator("div.rounded-lg")
    .filter({ hasText: "Sunday Morning" })
    .filter({ hasText: "Omar Osei" });
  await expect(omarRow).toBeVisible();
  await omarRow.getByRole("button", { name: "Request swap" }).click();

  // Modal closes and erin's slot is now frozen mid-trade (she can cancel).
  await expect(erinCard.getByText("Pending swap")).toBeVisible();
  await expect(
    erinCard.getByRole("button", { name: "Cancel swap" })
  ).toBeVisible();

  // ── omar accepts from his Covers / Swaps section. ───────────────────────────────
  await login(page, "omar");
  await page.goto("/swaps");
  const incoming = page.locator("li").filter({ hasText: "Erin Evans" }).first();
  await expect(incoming).toBeVisible();
  await incoming.getByRole("button", { name: "Accept" }).click();

  // The slots switch immediately, but as PENDING_APPROVAL — an admin still has
  // to sign off before it's final. The proposal card is gone from omar's view.
  const omarCard = page
    .locator("li")
    .filter({ hasText: "Sunday Morning — Electric Guitar" })
    .first();
  await expect(omarCard.getByText("Pending approval")).toBeVisible();
  await expect(page.getByText("Erin Evans")).toHaveCount(0);

  // ── An admin approves the swap → both slots finalize to Confirmed. ───────
  await login(page, "admin");
  await page.goto("/approvals");
  const swapItem = page
    .locator("li")
    .filter({ hasText: "Swap" })
    .filter({ hasText: "Omar Osei" })
    .first();
  await expect(swapItem).toBeVisible();
  await swapItem.getByRole("button", { name: "Approve" }).click();
  await expect(swapItem).not.toBeVisible();

  await login(page, "omar");
  await page.goto("/swaps");
  await expect(
    page
      .locator("li")
      .filter({ hasText: "Sunday Morning — Electric Guitar" })
      .first()
      .getByText("Confirmed")
  ).toBeVisible();

  // ── Stats moved (only once the swap was APPROVED): erin requested one swap,
  //    omar took (accepted) one. ──────────────────────────────────────────
  await login(page, "admin");
  expect((await statsFor(page, "erin")).swapsRequested).toBe(erinBefore + 1);
  expect((await statsFor(page, "omar")).swapsTaken).toBe(omarBefore + 1);
});
