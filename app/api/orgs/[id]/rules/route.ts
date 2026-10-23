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
import {
  defaultRoleRules,
  validateRules,
  type RuleKind,
} from "@/lib/schedulingRules";
import {
  ACOUSTIC_GUITAR,
  ACOUSTIC_HOST_ROLES,
  MD_ROLES,
  OVERLAP_ALLOWED_PAIRS,
} from "@/lib/constants";

// The kinds whose absence means "this org has never been given the defaults".
const ROLE_RULE_KINDS: RuleKind[] = ["LEADS_FROM", "ROLE_HOST", "MAY_DOUBLE"];
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

  // The role-shaped rules (LEADS_FROM / ROLE_HOST / MAY_DOUBLE) describe what
  // used to be hardcoded. `resolveRoleBehavior` already falls back to those
  // built-in values when an org has no rule for them, so this write changes no
  // behaviour whatsoever — it materializes the defaults so an admin can SEE and
  // edit them. Done here, on the first look at the editor, rather than as a
  // migration: it covers new and existing orgs alike, and an org that never
  // opens this page is no worse off. Deleting one is honoured (it means "no
  // such rule"), so this only fires while NONE of the three kinds is present.
  let list = rules;
  if (!list.some((r) => ROLE_RULE_KINDS.includes(r.params.kind))) {
    await saveOrgRules(id, [
      ...list.map(({ tier, enabled, params }) => ({ tier, enabled, params })),
      ...defaultRoleRules({
        mdRoles: MD_ROLES,
        hostRoles: { [ACOUSTIC_GUITAR]: ACOUSTIC_HOST_ROLES },
        doublePairs: OVERLAP_ALLOWED_PAIRS,
      }),
    ]);
    list = await loadOrgRules(id);
  }
  return NextResponse.json({ rules: list, options: await ruleEditorOptions(id) });
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
