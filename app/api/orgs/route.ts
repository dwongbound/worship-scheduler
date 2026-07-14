// GET /api/orgs — the current user's org memberships (id, name, isAdmin),
// oldest org first. Also the app's regular touchpoint for syncing env-declared
// orgs into the db (OrgProvider hits this on every page load).
import { NextResponse } from "next/server";
import { getSessionUser, isSuperAdmin } from "@/lib/auth";
import { ensureOrgsSynced, getMyMemberships } from "@/lib/org";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureOrgsSynced();

  // Super-admins administer every org, so they see them all (each as admin) —
  // not just the ones they've joined.
  if (isSuperAdmin(user.email)) {
    const orgs = await prisma.org.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });
    return NextResponse.json(
      orgs.map((o) => ({ id: o.id, name: o.name, isAdmin: true }))
    );
  }

  const memberships = await getMyMemberships(user.id);
  return NextResponse.json(
    memberships.map((m) => ({ id: m.orgId, name: m.orgName, isAdmin: m.isAdmin }))
  );
}
