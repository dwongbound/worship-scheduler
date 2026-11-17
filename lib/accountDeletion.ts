// Deleting your own account — the rules both doors share (the web's /profile
// and the iOS app's Account tab, which App Store rule 5.1.1(v) requires).
//
// Pure. The prisma side is the DELETE handler in app/api/me/route.ts.
//
// What deleting does is the User row's own cascade (prisma/schema.prisma):
// memberships, team seats, EVERY assignment (past sets lose them from their
// roster too), availability, cover declines, swaps and drafts all go; set
// history keeps its lines with the person blanked (SetNull), and sets they
// directed lose their MD. That is what the confirmation spells out.

/** What has to be typed before the button arms. Checked again on the server,
 * so no client — an old app build, a stray script — deletes an account by
 * merely calling the route. */
export const DELETE_CONFIRM_PHRASE = "DELETE";

export function confirmationMatches(typed: unknown): boolean {
  return typeof typed === "string" && typed.trim() === DELETE_CONFIRM_PHRASE;
}

export interface OrgAdminPicture {
  orgId: string;
  orgName: string;
  /** Am I an admin here? */
  isAdmin: boolean;
  /** How many admins this org has, me included. */
  adminCount: number;
  /** How many members this org has, me included. */
  memberCount: number;
}

/**
 * The orgs my leaving would strand: I'm their ONLY admin and somebody else is
 * still in them, so nobody would be left who could run it — or make anyone
 * else an admin. The same reason the Team tab refuses to remove yourself. An
 * org I'm alone in strands no one, so it doesn't block.
 */
export function strandedOrgs(orgs: OrgAdminPicture[]): { orgId: string; orgName: string }[] {
  return orgs
    .filter((o) => o.isAdmin && o.adminCount <= 1 && o.memberCount > 1)
    .map(({ orgId, orgName }) => ({ orgId, orgName }));
}

/** The refusal, in words, naming each org. */
export function strandedMessage(orgs: { orgName: string }[]): string {
  const names = orgs.map((o) => o.orgName);
  const list =
    names.length <= 1
      ? names.join("")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `You're the only admin of ${list}. Make someone else an admin there first, so the org isn't left without one.`;
}
