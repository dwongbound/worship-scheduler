// The prisma side of lib/nameConflict — kept separate so the login page can
// import the vocabulary without pulling the db client into the client bundle.
import { type NameConflict, normalizeName } from "./nameConflict";
import { prisma } from "./prisma";

/**
 * Existing accounts whose name matches `name` case-insensitively, excluding the
 * address the person is signing up with (that's the claim path's business, not
 * a conflict). Returns [] for a blank name.
 */
export async function findNameConflicts(
  name: string,
  excludeEmail?: string
): Promise<NameConflict[]> {
  const normalized = normalizeName(name);
  if (!normalized) return [];

  const rows = await prisma.user.findMany({
    where: { name: { equals: normalized, mode: "insensitive" } },
    select: { name: true, email: true, isPlaceholder: true },
    orderBy: { createdAt: "asc" },
  });

  const skip = excludeEmail?.trim().toLowerCase();
  return rows
    .filter((r): r is typeof r & { email: string } => !!r.email)
    .filter((r) => r.email.toLowerCase() !== skip)
    .map((r) => ({
      name: r.name,
      email: r.email,
      isPlaceholder: r.isPlaceholder,
    }));
}
