// GET  /api/admin/approvals  — cover-takes + targeted swaps in this org that
//                              are awaiting an admin's approval.
// POST /api/admin/approvals  { kind: "swap"|"cover", id, action: "approve"|"reject" }
//   Approve finalizes the handoff (CONFIRMED). Reject undoes it: a swap snaps
//   both slots back to their original owners/statuses; a cover re-opens as an
//   open cover request (SWAP_REQUESTED) for someone else to take.
// Org comes from the x-org-id header (requireOrgAdmin); everything is scoped to
// sets in that org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";

const setSelect = {
  select: {
    id: true,
    label: true,
    startsAt: true,
    org: { select: { id: true, name: true } },
  },
} as const;

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [swaps, covers] = await Promise.all([
    prisma.swapProposal.findMany({
      where: {
        status: "PENDING_APPROVAL",
        toAssignment: { set: { orgId: admin.orgId } },
      },
      include: {
        requestedBy: { select: { id: true, name: true } },
        recipient: { select: { id: true, name: true } },
        fromAssignment: { select: { role: true, set: setSelect } },
        toAssignment: { select: { role: true, set: setSelect } },
      },
      orderBy: { respondedAt: "desc" },
    }),
    prisma.assignment.findMany({
      where: {
        status: "PENDING_APPROVAL",
        pendingCoverFromUserId: { not: null },
        set: { orgId: admin.orgId },
      },
      include: {
        user: { select: { id: true, name: true } }, // the taker (current owner)
        set: setSelect,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // pendingCoverFromUserId has no FK, so resolve the original owners' names.
  const ownerIds = covers.map((c) => c.pendingCoverFromUserId!).filter(Boolean);
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  const items = [
    ...swaps.map((p) => ({
      kind: "swap" as const,
      id: p.id,
      role: p.toAssignment.role,
      reason: p.reason,
      createdAt: p.respondedAt ?? p.createdAt,
      // After acceptance the slots are already switched: the recipient took the
      // requester's set (`receive`), the requester took the recipient's (`giveUp`).
      requester: p.requestedBy,
      recipient: p.recipient,
      receive: p.fromAssignment.set, // requester's set, now the recipient's
      giveUp: p.toAssignment.set, // recipient's set, now the requester's
    })),
    ...covers.map((a) => ({
      kind: "cover" as const,
      id: a.id,
      role: a.role,
      reason: a.swapReason,
      createdAt: a.updatedAt,
      taker: a.user,
      originalOwner: ownerById.get(a.pendingCoverFromUserId!) ?? null,
      set: a.set,
    })),
  ].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt));

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { kind, id, action } = await req.json();
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  if (kind === "cover") return handleCover(id, action, admin.orgId, admin.user.id);
  if (kind === "swap") return handleSwap(id, action, admin.orgId, admin.user.id);
  return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
}

async function handleCover(
  id: string,
  action: "approve" | "reject",
  orgId: string,
  adminId: string
) {
  const a = await prisma.assignment.findUnique({
    where: { id },
    include: { set: { select: { orgId: true } } },
  });
  if (
    !a ||
    a.set.orgId !== orgId ||
    a.status !== "PENDING_APPROVAL" ||
    !a.pendingCoverFromUserId
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (action === "approve") {
    // Finalize: the taker keeps the slot, confirmed; the cover note is done.
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: a.id },
        data: { status: "CONFIRMED", pendingCoverFromUserId: null, swapReason: null },
      }),
      prisma.setHistoryEvent.create({
        data: {
          setId: a.setId,
          role: a.role,
          type: "APPROVED",
          actorId: adminId,
          targetUserId: a.userId,
          previousUserId: a.pendingCoverFromUserId,
        },
      }),
    ]);
  } else {
    // Reject: hand the slot back to the original owner and re-open the cover so
    // someone else can take it (keep the note).
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: a.id },
        data: {
          userId: a.pendingCoverFromUserId,
          status: "SWAP_REQUESTED",
          pendingCoverFromUserId: null,
        },
      }),
      prisma.setHistoryEvent.create({
        data: {
          setId: a.setId,
          role: a.role,
          type: "REJECTED",
          actorId: adminId,
          targetUserId: a.pendingCoverFromUserId,
          previousUserId: a.userId,
        },
      }),
    ]);
  }
  return NextResponse.json({ ok: true });
}

async function handleSwap(
  id: string,
  action: "approve" | "reject",
  orgId: string,
  adminId: string
) {
  const p = await prisma.swapProposal.findUnique({
    where: { id },
    include: {
      fromAssignment: { select: { id: true, setId: true, role: true } },
      toAssignment: { select: { id: true, setId: true, role: true, set: { select: { orgId: true } } } },
    },
  });
  if (!p || p.toAssignment.set.orgId !== orgId || p.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { fromAssignment: from, toAssignment: to } = p;
  const type = action === "approve" ? "APPROVED" : "REJECTED";

  if (action === "approve") {
    await prisma.$transaction([
      prisma.assignment.update({ where: { id: from.id }, data: { status: "CONFIRMED" } }),
      prisma.assignment.update({ where: { id: to.id }, data: { status: "CONFIRMED" } }),
      prisma.swapProposal.update({
        where: { id: p.id },
        data: { status: "ACCEPTED" },
      }),
      historyFor(from.setId, from.role, type, adminId),
      historyFor(to.setId, to.role, type, adminId),
    ]);
  } else {
    // Undo the exchange: put each set back with its original owner + status.
    await prisma.$transaction([
      prisma.assignment.update({
        where: { id: from.id },
        data: { userId: p.requestedById, status: p.fromPrevStatus },
      }),
      prisma.assignment.update({
        where: { id: to.id },
        data: { userId: p.recipientId, status: p.toPrevStatus },
      }),
      prisma.swapProposal.update({
        where: { id: p.id },
        data: { status: "REJECTED" },
      }),
      historyFor(from.setId, from.role, type, adminId),
      historyFor(to.setId, to.role, type, adminId),
    ]);
  }
  return NextResponse.json({ ok: true });
}

// A bare APPROVED/REJECTED activity line (actor = the admin).
function historyFor(
  setId: string,
  role: import("@/lib/constants").Instrument,
  type: "APPROVED" | "REJECTED",
  adminId: string
) {
  return prisma.setHistoryEvent.create({
    data: { setId, role, type, actorId: adminId },
  });
}
