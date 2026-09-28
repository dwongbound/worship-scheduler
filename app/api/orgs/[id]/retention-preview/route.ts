// GET /api/orgs/[id]/retention-preview?months=N — what switching this org to an
// N-month window would delete, counted and not deleted.
//
// It exists so the confirmation dialog can be specific. "Older data may be
// deleted" is the kind of warning people click through; "this deletes 142 sets,
// 1,204 roster entries and 3 availability requests, permanently" is not. The
// numbers are read at the moment the dialog opens, against the same cutoff the
// sweep will use.
//
// Org-admin gated, like the settings it belongs to.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { isRetentionMonths } from "@/lib/retention";
import { previewOrgPrune } from "@/lib/retentionStore";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const months = Number(req.nextUrl.searchParams.get("months"));
  if (!isRetentionMonths(months)) {
    return NextResponse.json(
      { error: "That isn't one of the retention windows." },
      { status: 400 }
    );
  }

  return NextResponse.json(await previewOrgPrune(id, months));
}
