// Organizations: the highest-level tenant boundary. Orgs and their join keys
// are declared in the ORG_KEYS env var ("Name:key,Name:key"); DB rows are
// auto-upserted from it BY NAME (so renaming an org in env creates a new,
// empty org — rename the db row instead to keep its data).
//
// This module is server-only (it imports prisma). It also owns the org-aware
// admin checks that replaced the old global getAdminUser():
//   requireOrgAdmin(req)    — org comes from the "x-org-id" request header
//                             (admin collection routes: lists + creates)
//   requireOrgAdminFor(id)  — org derived from the resource being touched
//                             (routes addressed by resource id)
import type { NextRequest } from "next/server";
import { prisma } from "./prisma";
import { getSessionUser, isSuperAdmin } from "./auth";
import { MIGRATION_PLACEHOLDER, parseOrgKeys } from "./orgKeys";

// Sync env orgs into the db once per server process. The migration's
// placeholder org adopts the FIRST env org's name (so pre-org data lands in
// it); every other env org is upserted by name.
let syncPromise: Promise<void> | null = null;

export function ensureOrgsSynced(): Promise<void> {
  syncPromise ??= (async () => {
    const entries = parseOrgKeys();
    if (entries.length === 0) return;

    const placeholder = await prisma.org.findUnique({
      where: { name: MIGRATION_PLACEHOLDER },
      select: { id: true },
    });
    if (placeholder) {
      const firstTaken = await prisma.org.findUnique({
        where: { name: entries[0].name },
        select: { id: true },
      });
      if (!firstTaken) {
        await prisma.org.update({
          where: { id: placeholder.id },
          data: { name: entries[0].name },
        });
      }
    }

    for (const { name, key } of entries) {
      await prisma.org.upsert({
        where: { name },
        update: {},
        create: { name, joinKey: key },
      });
      // Backfill the join key for orgs created before keys moved to the db.
      // Only fill when null so a key rotated via the platform admin page wins.
      await prisma.org.updateMany({
        where: { name, joinKey: null },
        data: { joinKey: key },
      });
    }
  })().catch((err) => {
    // Allow a retry on the next call instead of caching the failure forever.
    syncPromise = null;
    throw err;
  });
  return syncPromise;
}

/**
 * Redeem an org key for a user: upserts the Org row and the membership.
 * Idempotent — re-redeeming never demotes an existing admin membership.
 * Returns the joined org, or null for an unknown key.
 */
export async function redeemOrgKey(
  userId: string,
  key: string
): Promise<{ orgId: string; name: string } | null> {
  // ensureOrgsSynced backfills any env-declared orgs/keys into the db first;
  // after that the join key lives in the db (rotatable via the platform page).
  await ensureOrgsSynced();
  const org = await prisma.org.findFirst({
    where: { joinKey: key },
    select: { id: true, name: true },
  });
  if (!org) return null;

  await prisma.orgMembership.upsert({
    where: { userId_orgId: { userId, orgId: org.id } },
    update: {},
    create: { userId, orgId: org.id },
  });
  return { orgId: org.id, name: org.name };
}

/** Ids of every org the user belongs to. */
export async function getMyOrgIds(userId: string): Promise<string[]> {
  const rows = await prisma.orgMembership.findMany({
    where: { userId },
    select: { orgId: true },
  });
  return rows.map((r) => r.orgId);
}

/** The user's memberships with org names, oldest org first. */
export async function getMyMemberships(userId: string) {
  const rows = await prisma.orgMembership.findMany({
    where: { userId },
    select: { orgId: true, isAdmin: true, org: { select: { name: true, createdAt: true } } },
    orderBy: { org: { createdAt: "asc" } },
  });
  return rows.map((r) => ({ orgId: r.orgId, orgName: r.org.name, isAdmin: r.isAdmin }));
}

/**
 * Resolve a member GET's org scope: the optional ?orgId= narrows the view,
 * but is always clamped to orgs the user actually belongs to.
 */
export async function resolveOrgScope(
  userId: string,
  requestedOrgId: string | null
): Promise<string[]> {
  // Super-admins can view any org, so their scope isn't clamped to memberships.
  const user = await getSessionUser();
  if (isSuperAdmin(user?.email)) {
    if (requestedOrgId && requestedOrgId !== "all") return [requestedOrgId];
    const all = await prisma.org.findMany({ select: { id: true } });
    return all.map((o) => o.id);
  }
  const mine = await getMyOrgIds(userId);
  if (requestedOrgId && requestedOrgId !== "all") {
    return mine.includes(requestedOrgId) ? [requestedOrgId] : [];
  }
  return mine;
}

/**
 * Admin gate for org-scoped collection routes. The client names the org via
 * the "x-org-id" header; we verify the caller's membership in THAT org has
 * isAdmin (re-checked in the db, so revoking takes effect immediately).
 */
export async function requireOrgAdmin(
  req: NextRequest
): Promise<{ user: { id: string }; orgId: string } | null> {
  const orgId = req.headers.get("x-org-id");
  if (!orgId) return null;
  const result = await requireOrgAdminFor(orgId);
  return result ? { user: result.user, orgId } : null;
}

/** Admin gate when the org is derived from the resource being touched. */
export async function requireOrgAdminFor(
  orgId: string
): Promise<{ user: { id: string } } | null> {
  const user = await getSessionUser();
  if (!user) return null;
  // Platform super-admins have admin rights in EVERY org (even ones they
  // haven't joined) — they're the app owners.
  if (isSuperAdmin(user.email)) return { user: { id: user.id } };
  const membership = await prisma.orgMembership.findUnique({
    where: { userId_orgId: { userId: user.id, orgId } },
    select: { isAdmin: true },
  });
  return membership?.isAdmin ? { user: { id: user.id } } : null;
}
