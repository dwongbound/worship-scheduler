// POST /api/orgs/join — redeem an org key (from the /join page or the
// navbar's "Add an org…"). Creates the membership; idempotent for existing
// members. The client follows success with useSession().update() so the
// JWT's membership hints refresh immediately.
import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { redeemOrgKey } from "@/lib/org";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { key } = await req.json();
  if (typeof key !== "string" || key.trim().length === 0) {
    return NextResponse.json({ error: "Enter an organization key" }, { status: 400 });
  }

  const joined = await redeemOrgKey(user.id, key.trim());
  if (!joined) {
    return NextResponse.json(
      { error: "That key doesn't match any organization" },
      { status: 400 }
    );
  }
  return NextResponse.json({ id: joined.orgId, name: joined.name });
}
