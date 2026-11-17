// How the access key's reads look on the wire, pure (unit-tested in
// tests/unit/agentView.test.ts); lib/agentSnapshot.ts is the db half. Shaped
// for a model to read aloud: names rather than ids where a person would say a
// name, role LABELS rather than keys, ISO instants, and the ids a writing
// tool needs (`assignmentId`) right beside the seat they act on.
//
// What's here is what the person SEES in the app: their orgs' sets (private
// ones only where they're seated or an org admin, the same filter the
// calendar uses), who is playing, songs and practices, covers they could
// take, and their own availability requests. Never anyone's email, Slack id
// or availability.
import type { AssignmentStatus } from "./generated/prisma/client";
import { roleLabel, type TeamRoleDef } from "./teamRoles";
import { setLinkPath } from "./setLink";

/** Each seat status in words, for a model to say. */
export const STATUS_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "Not confirmed yet",
  CONFIRMED: "Confirmed",
  SWAP_REQUESTED: "Asked for cover",
  PENDING_SWAP: "Swap offered, waiting on an answer",
  PENDING_APPROVAL: "Handed over, waiting on an admin's approval",
};

/** A set as the snapshot reads it from the db (lib/agentSnapshot.ts SET_SELECT). */
export interface AgentSetRow {
  id: string;
  label: string | null;
  startsAt: Date;
  durationMinutes: number;
  teamId: string | null;
  mdUserId: string | null;
  org: { name: string };
  team: { name: string } | null;
  md: { name: string } | null;
  assignments: {
    id: string;
    role: string;
    status: AssignmentStatus;
    userId: string;
    user: { name: string };
    guestTeam: { teamId: string } | null;
  }[];
  songs: { title: string; key: string | null; order: number }[];
  practices: { startsAt: Date; endsAt: Date }[];
}

/** Role catalogs by team id (lib/teamRoleStore.ts getTeamCatalogs). */
export type Catalogs = Map<string, TeamRoleDef[]>;

/** A seat's role in words, read against the team the seat came from. */
function seatRole(row: AgentSetRow, seat: AgentSetRow["assignments"][number], catalogs: Catalogs) {
  const teamId = seat.guestTeam?.teamId ?? row.teamId;
  return roleLabel(seat.role, teamId ? catalogs.get(teamId) : undefined);
}

/**
 * Where a seat sits on the roster: the set's own team first, in its role
 * order, then guest teams' seats in theirs. Unknown roles go last of their group.
 */
function roleRank(row: AgentSetRow, seat: AgentSetRow["assignments"][number], catalogs: Catalogs) {
  const teamId = seat.guestTeam?.teamId ?? row.teamId;
  const catalog = teamId ? catalogs.get(teamId) ?? [] : [];
  const i = catalog.findIndex((r) => r.key === seat.role);
  const inTeam = i === -1 ? catalog.length : i;
  // A team has nowhere near a thousand roles, so this keeps guests after hosts.
  if (seat.guestTeam) return 1000 + inTeam;
  return inTeam;
}

/** The set's name the way the app shows it: its label, else its team, else "Set". */
export function setName(row: Pick<AgentSetRow, "label" | "team">): string {
  if (row.label) return row.label;
  if (row.team) return row.team.name;
  return "Set";
}

/** One set: when, who, what's being played, and its practices. */
export function agentSet(row: AgentSetRow, catalogs: Catalogs, viewerId: string, origin: string) {
  const endsAt = new Date(row.startsAt.getTime() + row.durationMinutes * 60_000);
  const seats = [...row.assignments].sort(
    (a, b) => roleRank(row, a, catalogs) - roleRank(row, b, catalogs)
  );
  return {
    setId: row.id,
    name: setName(row),
    startsAt: row.startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    org: row.org.name,
    team: row.team?.name ?? null,
    musicalDirector: row.md?.name ?? null,
    youAreMusicalDirector: row.mdUserId === viewerId,
    roster: seats.map((seat) => ({
      name: seat.user.name,
      role: seatRole(row, seat, catalogs),
      status: STATUS_LABELS[seat.status],
      you: seat.userId === viewerId,
    })),
    songs: [...row.songs]
      .sort((a, b) => a.order - b.order)
      .map((song) => ({ title: song.title, key: song.key })),
    practices: row.practices.map((p) => ({
      startsAt: p.startsAt.toISOString(),
      endsAt: p.endsAt.toISOString(),
    })),
    link: origin + setLinkPath(row.id),
  };
}

/**
 * One of the viewer's own sets: the set, plus each seat they hold on it with
 * the `assignmentId` that confirm_set / request_cover / cancel_cover_request
 * take. A seat waiting on an admin after they took a cover is theirs too.
 */
export function agentMySet(row: AgentSetRow, catalogs: Catalogs, viewerId: string, origin: string) {
  const mine = row.assignments.filter((a) => a.userId === viewerId);
  return {
    ...agentSet(row, catalogs, viewerId, origin),
    yourSeats: mine.map((seat) => ({
      assignmentId: seat.id,
      role: seatRole(row, seat, catalogs),
      status: seat.status,
      statusInWords: STATUS_LABELS[seat.status],
    })),
    // The thing most worth saying out loud first.
    needsYourConfirmation: mine.some((seat) => seat.status === "PENDING"),
  };
}

/** An open cover the viewer could take (lib/openCovers.ts), for take_cover. */
export function agentCover(
  cover: {
    id: string;
    role: string;
    reason: string | null;
    user: { name: string };
    set: { id: string; label: string | null; startsAt: Date; durationMinutes: number; teamId: string | null; org: { name: string } };
  },
  catalogs: Catalogs,
  teamNames: Map<string, string>,
  origin: string
) {
  const team = cover.set.teamId ? teamNames.get(cover.set.teamId) ?? null : null;
  const endsAt = new Date(cover.set.startsAt.getTime() + cover.set.durationMinutes * 60_000);
  return {
    assignmentId: cover.id,
    setId: cover.set.id,
    set: setName({ label: cover.set.label, team: team ? { name: team } : null }),
    startsAt: cover.set.startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    org: cover.set.org.name,
    team,
    role: roleLabel(cover.role, cover.set.teamId ? catalogs.get(cover.set.teamId) : undefined),
    askedBy: cover.user.name,
    reason: cover.reason,
    link: origin + setLinkPath(cover.set.id, "set-manager"),
  };
}

/** One org's current availability request, and whether the viewer still owes it. */
export function agentAvailability(
  item: {
    request: { name: string | null; startDate: Date; endDate: Date; org: { name: string } };
    needsResponse: boolean;
  },
  origin: string
) {
  return {
    org: item.request.org.name,
    request: item.request.name,
    from: item.request.startDate.toISOString(),
    to: item.request.endDate.toISOString(),
    stillNeedsYourAvailability: item.needsResponse,
    link: origin + "/schedule",
  };
}
