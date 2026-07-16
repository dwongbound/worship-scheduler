// Who may be a set's musical director (MD), and which one is picked by default.
//
// A set has exactly one MD, stored explicitly as `Set.mdUserId`. To be eligible
// a person must, on THIS set: be a musical director (`isMD`), hold an MD-capable
// role (keys / electric guitar / bass — see MD_ROLES), and NOT be the worship
// leader. These helpers are the single source of that rule, reused by the detail
// modal, the generate preview, the API, and the Slack summary.
import type { Instrument } from "@/lib/generated/prisma/client";
import { MD_ROLES, ROLE_ORDER } from "@/lib/constants";

// The minimal per-assignment shape these helpers need. `isMD` is the assignee's
// global musical-director flag (User.isMD); it may be absent on client refs, in
// which case the person is treated as not an MD.
export interface MDAssignment {
  userId: string;
  role: Instrument;
  isMD?: boolean;
}

// userIds assigned as worship leader on this set — never eligible to also MD.
function worshipLeaderIds(assignments: MDAssignment[]): Set<string> {
  return new Set(
    assignments.filter((a) => a.role === "WORSHIP_LEADER").map((a) => a.userId)
  );
}

// Distinct userIds eligible to be the MD, in scarce-first role order (then by
// userId) so the "best" candidate comes first. A person with several slots
// appears once, keyed to their scarcest MD-capable role.
export function eligibleMDIds(assignments: MDAssignment[]): string[] {
  const wl = worshipLeaderIds(assignments);
  const seen = new Set<string>();
  const ids: string[] = [];
  // Walk roles scarce-first; within a role, sort assignees by id for determinism.
  for (const role of ROLE_ORDER) {
    if (!MD_ROLES.includes(role)) continue;
    const inRole = assignments
      .filter((a) => a.role === role && a.isMD && !wl.has(a.userId))
      .sort((a, b) => a.userId.localeCompare(b.userId));
    for (const a of inRole) {
      if (seen.has(a.userId)) continue;
      seen.add(a.userId);
      ids.push(a.userId);
    }
  }
  return ids;
}

// The auto-picked MD: the first eligible person, or null if nobody qualifies.
export function defaultMDId(assignments: MDAssignment[]): string | null {
  return eligibleMDIds(assignments)[0] ?? null;
}

// Whether a stored mdUserId is still a valid MD for the set's current roster —
// used to ignore a stale id (e.g. after the MD's slot was removed/reassigned).
export function isValidMD(
  mdUserId: string | null | undefined,
  assignments: MDAssignment[]
): boolean {
  return !!mdUserId && eligibleMDIds(assignments).includes(mdUserId);
}
