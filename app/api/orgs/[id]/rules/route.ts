// GET /api/orgs/[id]/rules — the org's scheduling rules, in order, plus the
//   people / roles / recurring sets / sets the editor's dropdowns offer.
//   `?forSet=<setId>` instead adds what the set detail modal's "Auto schedule"
//   needs to obey them for that ONE set: the sets around it (SAME_PLAYER
//   partners) and a month either side of bookings (LIMIT counts).
// PUT /api/orgs/[id]/rules — replace the whole list. Body: { rules: [{ tier,
//   enabled, params }] } in display order (preferences ranked by it). Every
//   rule is parsed, every id checked against this org, and the required ones
//   checked against each other (lib/schedulingRules.ts validateRules), so a
//   contradiction is refused here even if the editor missed it. 400 carries
//   `{ error, index }` — which rule it's about.
// Org admins only. See lib/schedulingRules.ts.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminFor } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { validateRules } from "@/lib/schedulingRules";
import {
  loadOrgRules,
  orgRuleRefs,
  ruleContext,
  ruleEditorOptions,
  saveOrgRules,
} from "@/lib/schedulingRuleStore";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const rules = await loadOrgRules(id);

  const forSet = req.nextUrl.searchParams.get("forSet");
  if (forSet) {
    const set = await prisma.set.findUnique({
      where: { id: forSet },
      select: { orgId: true, startsAt: true },
    });
    if (!set || set.orgId !== id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const context = await ruleContext(id, rules, set.startsAt, set.startsAt);
    return NextResponse.json({ rules, ...context });
  }

  return NextResponse.json({ rules, options: await ruleEditorOptions(id) });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!(await requireOrgAdminFor(id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const refs = await orgRuleRefs(id);
  const result = validateRules(body?.rules, refs);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, index: result.index }, { status: 400 });
  }
  await saveOrgRules(id, result.rules);
  return NextResponse.json({ rules: await loadOrgRules(id, refs) });
}
