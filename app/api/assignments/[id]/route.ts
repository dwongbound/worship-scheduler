// PATCH /api/assignments/:id — act on one of MY assignments.
// Body: { action: "confirm" | "requestSwap" | "cancelSwap" }
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notifySwapRequested } from "@/lib/slack";
import type { AssignmentStatus } from "@/lib/generated/prisma/client";

// cancelSwap goes back to PENDING (not CONFIRMED) — the user still has to
// explicitly confirm the set afterwards.
const ACTION_TO_STATUS: Record<string, AssignmentStatus> = {
  confirm: "CONFIRMED",
  requestSwap: "SWAP_REQUESTED",
  cancelSwap: "PENDING",
};

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { action } = await req.json();
  const status = ACTION_TO_STATUS[action];
  if (!status) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const assignment = await prisma.assignment.findUnique({
    where: { id },
  });
  // Ownership check: you can only touch your own assignments.
  if (!assignment || assignment.userId !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.assignment.update({
    where: { id: assignment.id },
    data: { status },
  });

  // Opening a swap: let eligible players know via Slack. Non-throwing and a
  // no-op when Slack isn't configured, so it never affects the response.
  if (action === "requestSwap") {
    await notifySwapRequested(updated.id);
  }

  return NextResponse.json(updated);
}
