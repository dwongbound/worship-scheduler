// Who an availability request is aimed at.
//
// An admin picks the teams a request targets when creating it (defaulting to
// every team in the org). Only people on one of those teams owe it a response,
// see it on the Availabilities tab, or get the Slack DM.
//
// Membership alone is the test — NOT roles. Someone who just joined a targeted
// team and hasn't picked any instruments yet is still asked to fill it in.
//
// But the membership has to be an ACTIVE one. `TeamMember.active` is how a
// team pauses somebody (away for a term, on a break) without losing their
// roles or history, and a paused person isn't being scheduled — so asking them
// to keep their availability current is asking for work nobody will read. Hence
// three states, not two: someone can be asked, or paused out of being asked, or
// simply not on any of the targeted teams at all. The middle one still appears
// on the admin's status list (at the bottom, marked) so it's visible that they
// were skipped on purpose rather than lost.
//
// A request with NO teams attached means "the whole org": that's how rows
// created before team targeting existed behave, and it's the fallback for an
// org that has no teams yet. The pause rule still applies — paused on every
// team you're on is paused — but somebody on no team at all has nothing to be
// paused from, so they stay asked.
//
// (Unrelated to lib/availability.ts, which is the /schedule page's block math.)
import type { Prisma } from "@/lib/generated/prisma/client";

// Prisma `where` fragment: the requests this user actually owes a response to.
// Compose it with an org filter, e.g.
//   where: { orgId: { in: orgIds }, ...targetsUser(userId) }
export function targetsUser(
  userId: string
): Prisma.AvailabilityRequestWhereInput {
  return {
    OR: [
      {
        // Whole-org request — everyone is in scope except people paused on
        // every team they're on in that org.
        AND: [
          { teams: { none: {} } },
          {
            OR: [
              { org: { teams: { none: { members: { some: { userId } } } } } },
              {
                org: {
                  teams: { some: { members: { some: { userId, active: true } } } },
                },
              },
            ],
          },
        ],
      },
      // Team-targeted — an active membership on at least one targeted team.
      { teams: { some: { members: { some: { userId, active: true } } } } },
    ],
  };
}

/**
 * The same rule from the OrgMembership side: which of an org's members a
 * request aimed at `teamIds` reaches. Compose into a prisma.orgMembership
 * `where` — it's what decides who the "please enter your availability" DM
 * goes to, and it has to agree with targetsUser or the DM nags people the app
 * never asks.
 */
export function membersTargetedBy(
  orgId: string,
  teamIds: string[]
): Prisma.OrgMembershipWhereInput {
  if (teamIds.length > 0) {
    return {
      user: { teamMembers: { some: { teamId: { in: teamIds }, active: true } } },
    };
  }
  return {
    OR: [
      { user: { teamMembers: { none: { team: { orgId } } } } },
      { user: { teamMembers: { some: { team: { orgId }, active: true } } } },
    ],
  };
}

/** Where one person stands with a request. See the header comment. */
export type RequestAudience =
  // On a targeted team and active there: owes a response.
  | "asked"
  // On a targeted team but paused on all of them: skipped, and shown as such.
  | "inactive"
  // Not on any targeted team: the request has nothing to do with them.
  | "not-asked";

/**
 * The rule against rows already in hand: where does someone on `myTeams` stand
 * with a request aimed at `requestTeamIds`? Used by the admin status panel,
 * which filters and orders the member list client-side.
 */
export function requestAudienceFor(
  requestTeamIds: string[],
  myTeams: { id: string; active: boolean }[]
): RequestAudience {
  if (requestTeamIds.length === 0) {
    // Whole-org request. Nobody is out of scope; the only question is whether
    // this person is paused everywhere they belong.
    if (myTeams.length === 0) return "asked";
    return myTeams.some((t) => t.active) ? "asked" : "inactive";
  }
  const onTargeted = myTeams.filter((t) => requestTeamIds.includes(t.id));
  if (onTargeted.length === 0) return "not-asked";
  return onTargeted.some((t) => t.active) ? "asked" : "inactive";
}
