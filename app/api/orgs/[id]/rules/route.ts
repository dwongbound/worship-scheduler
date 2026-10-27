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
//   `{ error, index }` — which rule it's about. The body also carries the
//   `version` the editor loaded: these rules are ORG-wide and every save
//   replaces the WHOLE list, so a save built on a stale copy would silently
//   revert whatever another admin changed in between. A mismatch is a 409 with
//   `{ stale: true, rules, version }` — the list as it now stands — and
//   nothing is written.
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
  orgRulesVersion,
  ruleContext,
  ruleEditorOptions,
  saveOrgRules,
  StaleRulesError,
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
  //
  // APPEND-ONLY, deliberately: `saveOrgRules` replaces the whole list, and
  // `loadOrgRules` drops rules naming something since deleted — so rewriting
  // the list here would quietly PERSIST those drops, turning a read of this
  // page into data loss. These rows are inserted after the last position and
  // nothing already stored is touched.
  let list = rules;
  if (!list.some((r) => ROLE_RULE_KINDS.includes(r.params.kind))) {
    const last = await prisma.schedulingRule.aggregate({
      where: { orgId: id },
      _max: { position: true },
    });
    let position = (last._max.position ?? -1) + 1;
    await prisma.schedulingRule.createMany({
      data: defaultRoleRules({
        mdRoles: MD_ROLES,
        hostRoles: { [ACOUSTIC_GUITAR]: ACOUSTIC_HOST_ROLES },
        doublePairs: OVERLAP_ALLOWED_PAIRS,
      }).map((r) => ({
        orgId: id,
        tier: r.tier,
        enabled: r.enabled,
        params: r.params,
        position: position++,
      })),
    });
    list = await loadOrgRules(id);
  }
  // `version` is the fingerprint of the list as stored: the editor sends it
  // back with its save so a save built on a stale copy is refused rather than
  // reverting another admin's edits. These rules are ORG-wide, so two admins
  // are always editing the same list.
  return NextResponse.json({
    rules: list,
    version: await orgRulesVersion(id),
    options: await ruleEditorOptions(id),
  });
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
  // A stale save is refused with the list as it NOW stands, so the editor can
  // show the truth instead of its own copy. 409: the request was fine, the
  // list simply moved under it.
  try {
    await saveOrgRules(
      id,
      result.rules,
      typeof body?.version === "string" ? body.version : undefined
    );
  } catch (err) {
    if (err instanceof StaleRulesError) {
      return NextResponse.json(
        {
          error:
            "Someone else changed these rules while you had them open, so nothing was saved. The list below is up to date — try again.",
          stale: true,
          rules: await loadOrgRules(id, refs),
          version: await orgRulesVersion(id),
        },
        { status: 409 }
      );
    }
    throw err;
  }
  return NextResponse.json({
    rules: await loadOrgRules(id, refs),
    version: await orgRulesVersion(id),
  });
}
