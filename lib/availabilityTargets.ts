// Who an availability request is aimed at.
//
// An admin picks the teams a request targets when creating it (defaulting to
// every team in the org). Only people on one of those teams owe it a response,
// see it on the Availabilities tab, or get the Slack DM.
//
// Membership alone is the test — NOT roles. Someone who just joined a targeted
// team and hasn't picked any instruments yet is still asked to fill it in.
//
// A request with NO teams attached means "the whole org": that's how rows
// created before team targeting existed behave, and it's the fallback for an
// org that has no teams yet.
//
// (Unrelated to lib/availability.ts, which is the /schedule page's block math.)
import type { Prisma } from "@/lib/generated/prisma/client";

// Prisma `where` fragment: the requests this user is one of the targets of.
// Compose it with an org filter, e.g.
//   where: { orgId: { in: orgIds }, ...targetsUser(userId) }
export function targetsUser(
  userId: string
): Prisma.AvailabilityRequestWhereInput {
  return {
    OR: [
      { teams: { none: {} } }, // whole-org request
      { teams: { some: { members: { some: { userId } } } } },
    ],
  };
}

// The same rule against rows already in hand: does a request aimed at
// `requestTeamIds` reach someone who belongs to `myTeamIds`? Used by the admin
// status panel, which filters the member list client-side.
export function requestTargetsTeams(
  requestTeamIds: string[],
  myTeamIds: string[]
): boolean {
  if (requestTeamIds.length === 0) return true; // whole-org request
  return requestTeamIds.some((id) => myTeamIds.includes(id));
}
