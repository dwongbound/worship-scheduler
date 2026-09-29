// GET/PATCH/DELETE /api/admin/drafts/[id] — one saved generate preview.
//
// GET returns the plan payload (the list endpoint deliberately omits it).
// PATCH re-saves an opened draft in place — both the explicit Save Draft on a
// draft you opened, and that draft's own autosave while you keep editing.
// DELETE is the trash icon; it's irreversible and the UI says so first.
//
// The org isn't taken from a header here: it's derived from the draft itself and
// then re-checked, so a draft id can't be used to reach into another org.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { canSaveDraft, normalizeDraftName } from "@/lib/drafts";
import type { Prisma } from "@/lib/generated/prisma/client";

// Load the draft and confirm the caller administers the org that owns it.
async function authorize(id: string) {
  const draft = await prisma.scheduleDraft.findUnique({
    where: { id },
    select: { id: true, orgId: true, name: true, isRecovery: true, plan: true },
  });
  if (!draft) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const admin = await requireOrgAdminFor(draft.orgId);
  if (!admin) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { draft };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await authorize(id);
  if (found.error) return found.error;
  const { draft } = found;
  return NextResponse.json({
    id: draft.id,
    name: draft.name,
    isRecovery: draft.isRecovery,
    plan: draft.plan,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await authorize(id);
  if (found.error) return found.error;

  const body = await req.json().catch(() => null);
  const data: Prisma.ScheduleDraftUpdateInput = {};
  if (body?.plan && typeof body.plan === "object") {
    data.plan = body.plan as Prisma.InputJsonValue;
  }
  // A re-save can rename, and can also PROMOTE the recovery row into a kept
  // draft — which is what "Save Draft" on an autosaved preview means. `name` is
  // only read when the caller sends the key, so an autosave PATCH (plan only)
  // never blanks a name someone chose.
  if ("name" in (body ?? {})) {
    data.name = normalizeDraftName(body.name);
    data.isRecovery = false;
    // Promoting the recovery row spends a keep-slot it was never counted
    // against, so the cap has to be re-checked here — re-saving a row that is
    // ALREADY kept is a replacement and needs no free slot, which is what
    // passing the id as `replacingId` says.
    const siblings = await prisma.scheduleDraft.findMany({
      where: { orgId: found.draft.orgId },
      select: { id: true, isRecovery: true },
    });
    const allowed = canSaveDraft(siblings, id);
    if (!allowed.ok) {
      return NextResponse.json({ error: allowed.reason }, { status: 409 });
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const saved = await prisma.scheduleDraft.update({
    where: { id },
    data,
    select: {
      id: true,
      name: true,
      isRecovery: true,
      createdAt: true,
      updatedAt: true,
      createdBy: { select: { name: true } },
    },
  });
  return NextResponse.json({
    id: saved.id,
    name: saved.name,
    isRecovery: saved.isRecovery,
    createdAt: saved.createdAt.toISOString(),
    updatedAt: saved.updatedAt.toISOString(),
    createdByName: saved.createdBy.name,
  });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const found = await authorize(id);
  if (found.error) return found.error;

  await prisma.scheduleDraft.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
