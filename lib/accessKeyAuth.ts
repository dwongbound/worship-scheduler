// The db half of lib/accessKeys.ts: who, if anyone, a request's access key
// belongs to. `getKeyUser` is for GET /api/agent and POST /api/mcp, which take
// a key and nothing else. `getActingUser` is for the few routes a key made
// "can act for me" may also write through — confirm / ask for cover / withdraw
// (PATCH /api/assignments/[id]) and take a cover (POST /api/swaps/[id]/take).
// Every other route still takes only a session: `getSessionUser` never reads
// an access key, so a key can't reach an admin route by accident.
import { prisma } from "./prisma";
import { getSessionUser } from "./auth";
import { bearerKey, hashAccessKey, shouldTouchLastUsed } from "./accessKeys";

/**
 * The person behind `Authorization: Bearer tw_…`, read fresh, or null for a
 * missing, unknown or revoked key. Nothing about what they may see rides on
 * the key: every read re-asks the db, so a key never sees more than its
 * person could today.
 */
export async function getKeyUser(req: Request) {
  const key = bearerKey(req.headers.get("authorization"));
  if (!key) return null;
  const row = await prisma.accessKey.findUnique({
    where: { keyHash: hashAccessKey(key) },
    select: {
      id: true,
      canWrite: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });
  if (!row || row.revokedAt) return null;
  if (shouldTouchLastUsed(row.lastUsedAt)) {
    await prisma.accessKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { ...row.user, canWrite: row.canWrite };
}

export type KeyUser = NonNullable<Awaited<ReturnType<typeof getKeyUser>>>;

/**
 * Who is doing this write: the signed-in person (cookie or the iOS app's
 * token), or else the person behind a key that was made "can act for me". The
 * key half carries NO org memberships, so even on an admin's account it can
 * only act on that person's own seats and covers — which is all the routes
 * that call this do.
 */
export async function getActingUser(req: Request) {
  const session = await getSessionUser();
  if (session) return session;
  const keyUser = await getKeyUser(req);
  if (!keyUser?.canWrite) return null;
  return {
    id: keyUser.id,
    name: keyUser.name,
    email: keyUser.email,
    memberships: [],
    isSuperAdmin: false,
  };
}

