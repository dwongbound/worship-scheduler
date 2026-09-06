// Who still owns a seat that's mid-handoff.
//
// Both kinds of handoff move the assignment to the taker IMMEDIATELY and park
// it at PENDING_APPROVAL until an admin approves:
//   • an open cover someone took  — the original owner is on the row itself
//     (Assignment.pendingCoverFromUserId);
//   • an accepted targeted swap   — the two slots have already exchanged users,
//     so the original owners live on the SwapProposal (the `from` slot was the
//     requester's, the `to` slot the recipient's).
// Until approval the handoff isn't final, so anything that reasons about who is
// really on a set — the MD rules above all (lib/md.ts) — needs the person the
// seat still belongs to, not the hopeful taker.
//
// Server-only: it reads prisma.
import { prisma } from "./prisma";

// The seat fields this needs; any prisma Assignment row satisfies it.
export interface HandoffSeat {
  id: string;
  status: string;
  pendingCoverFromUserId?: string | null;
}

// The still-owner of a pending seat, with the bits the MD rules care about.
export interface PendingOwner {
  id: string;
  name: string;
  isMD: boolean;
}

/**
 * Map assignmentId → the person a pending seat still belongs to. Seats that
 * aren't awaiting approval simply don't appear, and neither do ones whose
 * handoff record has since gone (nothing to restore them to).
 */
export async function pendingOwners(
  seats: HandoffSeat[]
): Promise<Map<string, PendingOwner>> {
  const pending = seats.filter((s) => s.status === "PENDING_APPROVAL");
  if (pending.length === 0) return new Map();

  // assignmentId → the userId it's still owned by.
  const ownerIdBySeat = new Map<string, string>();
  for (const s of pending) {
    if (s.pendingCoverFromUserId) ownerIdBySeat.set(s.id, s.pendingCoverFromUserId);
  }

  // The rest can only be halves of an accepted-but-unapproved targeted swap.
  const swapSeatIds = pending.filter((s) => !s.pendingCoverFromUserId).map((s) => s.id);
  if (swapSeatIds.length > 0) {
    const proposals = await prisma.swapProposal.findMany({
      where: {
        status: "PENDING_APPROVAL",
        OR: [
          { fromAssignmentId: { in: swapSeatIds } },
          { toAssignmentId: { in: swapSeatIds } },
        ],
      },
      select: {
        fromAssignmentId: true,
        toAssignmentId: true,
        requestedById: true,
        recipientId: true,
      },
    });
    for (const p of proposals) {
      // The slots swapped users on accept, so each one's previous owner is the
      // OTHER side's person.
      ownerIdBySeat.set(p.fromAssignmentId, p.requestedById);
      ownerIdBySeat.set(p.toAssignmentId, p.recipientId);
    }
  }

  const ids = Array.from(new Set(ownerIdBySeat.values()));
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, isMD: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));

  const out = new Map<string, PendingOwner>();
  for (const [seatId, userId] of ownerIdBySeat) {
    const u = byId.get(userId);
    if (u) out.set(seatId, { id: u.id, name: u.name, isMD: u.isMD });
  }
  return out;
}
