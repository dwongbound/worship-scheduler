// E2E: declining a targeted swap, with and without the optional note.
//
// Rejecting used to fire straight off the button. It now opens a modal
// offering a note, which lands in SwapProposal.declineNote and leads the
// proposer's "swap declined" DM — so there are two paths to hold down:
//
//   with a note    → the typed text is stored verbatim
//   without one    → the column stays NULL, and the DM just omits the sentence
//
// Both must also leave the two slots exactly as they were — a decline is a
// no-op on the roster — which is asserted below rather than assumed.
//
// The pair is henry → quinn, who NO other spec touches (the obvious choice,
// erin → omar, is targeted-swaps.spec's fixture). Sharing it was a real
// problem, not a tidiness one: the suite runs serially against one database
// with retries on, and targeted-swaps' first step is not idempotent — on a
// retry it finds the slot it already froze and there is no "Swap" button left
// to click. Borrowing its people made that pre-existing fragility fire.
//
// The note itself is only ever read by the Slack sender, so there's no screen
// that shows it back — the db is the only honest place to assert it. That's
// why this spec talks to prisma directly, which no other spec needs to.
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "../../lib/prisma";
import { login } from "./helpers";

test.afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Set up a targeted swap proposed TO `toName` by `fromUsername`, entirely over
 * the API so it doesn't depend on which sets earlier specs have already
 * traded. Returns the new proposal's id. (mobile.spec.ts has a near-twin of
 * this; kept local rather than shared so neither spec can break the other by
 * tightening it.)
 */
async function proposeSwapTo(
  page: Page,
  fromUsername: string,
  toName: string
): Promise<string> {
  await login(page, fromUsername);

  const mine = (await (await page.request.get("/api/assignments")).json()) as {
    id: string;
  }[];
  expect(mine.length, `${fromUsername} has no assignments`).toBeGreaterThan(0);

  // The first of my slots that has `toName` as a swap candidate.
  let fromAssignmentId: string | undefined;
  let toAssignmentId: string | undefined;
  for (const a of mine) {
    const res = await page.request.get(
      `/api/swaps/candidates?assignmentId=${a.id}`
    );
    if (!res.ok()) continue;
    const body = (await res.json()) as {
      items: { toAssignmentId: string; counterparty: { name: string } }[];
    };
    const hit = (body.items ?? []).find((c) => c.counterparty.name === toName);
    if (hit) {
      fromAssignmentId = a.id;
      toAssignmentId = hit.toAssignmentId;
      break;
    }
  }
  expect(
    fromAssignmentId,
    `no swap candidate named "${toName}" for ${fromUsername}`
  ).toBeTruthy();

  const res = await page.request.post("/api/swaps/propose", {
    data: { fromAssignmentId, toAssignmentId },
  });
  expect(res.ok(), `propose failed: ${res.status()}`).toBeTruthy();

  // The proposal we just made is the recipient's only pending one for this
  // pair; read its id back so the assertions can name the exact row.
  const proposal = await prisma.swapProposal.findFirst({
    where: { fromAssignmentId, toAssignmentId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  expect(proposal, "the proposal was not written").toBeTruthy();
  return proposal!.id;
}

/**
 * As the recipient: open the incoming card from `proposerName`, press Reject,
 * and work the decline modal. `note` of "" leaves the box untouched, which is
 * the whole point of the second test.
 */
async function declineFromUi(page: Page, proposerName: string, note: string) {
  await page.goto("/set-manager");
  const incoming = page.locator("li").filter({ hasText: proposerName }).first();
  await expect(incoming).toBeVisible();
  // Exact: the card itself is a role="button" whose accessible name is all of
  // its text, so a substring match hits the card rather than the button.
  await incoming.getByRole("button", { name: "Reject", exact: true }).click();

  // The regression this guards: Reject must PROMPT, not decline on the spot.
  const modal = page.getByRole("dialog");
  await expect(
    modal.getByRole("heading", { name: "Decline this swap" })
  ).toBeVisible();
  const box = modal.getByLabel("Reason for declining (optional)");
  await expect(box).toBeVisible();
  if (note) await box.fill(note);

  await modal.getByRole("button", { name: "Decline", exact: true }).click();
  // The card goes once the POST is through and the list reloads.
  await expect(incoming).toHaveCount(0);
}

test("declining a swap WITH a note stores the note verbatim", async ({
  page,
}) => {
  const proposalId = await proposeSwapTo(page, "henry", "Quinn Quezada");

  await login(page, "quinn");
  await declineFromUi(page, "Henry Hill", "I'm away that week");

  const row = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    select: { status: true, declineNote: true, fromAssignment: true },
  });
  expect(row?.status).toBe("REJECTED");
  expect(row?.declineNote).toBe("I'm away that week");
  // A decline is a no-op on the roster: henry's slot is unfrozen and still his.
  expect(row?.fromAssignment.status).not.toBe("PENDING_SWAP");
});

test("declining a swap WITHOUT a note leaves it null", async ({ page }) => {
  const proposalId = await proposeSwapTo(page, "henry", "Quinn Quezada");

  await login(page, "quinn");
  await declineFromUi(page, "Henry Hill", "");

  const row = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    select: { status: true, declineNote: true, fromAssignment: true },
  });
  expect(row?.status).toBe("REJECTED");
  // NULL, not "" — the DM tests `declineNote?.trim()`, and an empty string
  // would sail past a plain truthiness check in some future reader.
  expect(row?.declineNote).toBeNull();
  expect(row?.fromAssignment.status).not.toBe("PENDING_SWAP");
});

// Whitespace is the sneaky third case: the box is optional, so a stray space
// or newline is the most likely "empty" value to actually reach the server,
// and it must not produce a DM that opens with a blank sentence.
test("a whitespace-only note is stored as no note at all", async ({ page }) => {
  const proposalId = await proposeSwapTo(page, "henry", "Quinn Quezada");

  await login(page, "quinn");
  await declineFromUi(page, "Henry Hill", "   ");

  const row = await prisma.swapProposal.findUnique({
    where: { id: proposalId },
    select: { declineNote: true },
  });
  expect(row?.declineNote).toBeNull();
});
