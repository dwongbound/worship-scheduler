import { prisma } from "@/lib/prisma";

/** Is every one of these users a member of the org? (An empty list is.) */
export async function allInOrg(userIds: string[], orgId: string): Promise<boolean> {
  if (userIds.length === 0) return true;
  const count = await prisma.orgMembership.count({ where: { orgId, userId: { in: userIds } } });
  return count === userIds.length;
}
