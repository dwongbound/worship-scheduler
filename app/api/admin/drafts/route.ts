// GET/POST /api/admin/drafts — saved generate previews for one org.
//
// GET lists them WITHOUT their plan payloads: a plan is a whole schedule, and
// five of them would make opening the Drafts list far heavier than reading it
// needs to be. The plan comes back from GET /api/admin/drafts/[id] when one is
// actually opened.
//
// POST saves one. Two shapes, told apart by `isRecovery`:
//   • deliberate (the Save Draft button) — capped at MAX_DRAFTS per org.
//   • recovery (the 15-second autosave) — one per person per org, replaced in
//     place, never counted against the cap.
// Org admin only; org comes from the x-org-id header.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdmin } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { canSaveDraft, normalizeDraftName } from "@/lib/drafts";
import type { Prisma } from "@/lib/generated/prisma/client";

// Everything the list needs and nothing else — notably not `plan`.
const SUMMARY_FIELDS = {
  id: true,
  name: true,
  isRecovery: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { name: true } },
} as const;

type SummaryRow = {
  id: string;
  name: string | null;
  isRecovery: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: { name: string };
};

const toSummary = (d: SummaryRow) => ({
  id: d.id,
  name: d.name,
  isRecovery: d.isRecovery,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
  createdByName: d.createdBy.name,
});

export async function GET(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const drafts = await prisma.scheduleDraft.findMany({
    where: { orgId: admin.orgId },
    select: SUMMARY_FIELDS,
    // Most recently touched first — the one you're most likely to want back.
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(drafts.map(toSummary));
}

export async function POST(req: NextRequest) {
  const admin = await requireOrgAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => null);
  const plan = body?.plan;
  if (!plan || typeof plan !== "object") {
    return NextResponse.json({ error: "A plan is required." }, { status: 400 });
  }
  const isRecovery = body?.isRecovery === true;
  const name = isRecovery ? null : normalizeDraftName(body?.name);

  // The recovery slot is one row per person per org, overwritten in place, so
  // a long session leaves one autosave rather than a trail of them.
  if (isRecovery) {
    const existing = await prisma.scheduleDraft.findFirst({
      where: { orgId: admin.orgId, createdById: admin.user.id, isRecovery: true },
      select: { id: true },
    });
    const saved = existing
      ? await prisma.scheduleDraft.update({
          where: { id: existing.id },
          data: { plan: plan as Prisma.InputJsonValue },
          select: SUMMARY_FIELDS,
        })
      : await prisma.scheduleDraft.create({
          data: {
            orgId: admin.orgId,
            createdById: admin.user.id,
            isRecovery: true,
            plan: plan as Prisma.InputJsonValue,
          },
          select: SUMMARY_FIELDS,
        });
    return NextResponse.json(toSummary(saved));
  }

  // A deliberate save has to fit in the org's five keep-slots. Re-checked here
  // against the db rather than trusted from the client, which is working off a
  // list that may be minutes old.
  const existing = await prisma.scheduleDraft.findMany({
    where: { orgId: admin.orgId },
    select: { id: true, isRecovery: true },
  });
  const allowed = canSaveDraft(existing);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.reason }, { status: 409 });
  }

  const saved = await prisma.scheduleDraft.create({
    data: {
      orgId: admin.orgId,
      createdById: admin.user.id,
      name,
      plan: plan as Prisma.InputJsonValue,
    },
    select: SUMMARY_FIELDS,
  });
  return NextResponse.json(toSummary(saved));
}
