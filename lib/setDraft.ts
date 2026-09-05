// Staged edits to a set (components/SetDetailModal.tsx).
//
// The detail modal used to save every edit the moment you made it. It now
// keeps a working COPY of the set and saves the whole thing on "Save", which
// needs two things this module provides — both pure, so they're unit-tested
// without a browser (tests/unit/setDraft.test.ts):
//
//   • `describeSetChanges` — what changed, in words, for the "you have unsaved
//     changes" confirmation. The point is that a discard is never a surprise:
//     the admin reads exactly what they'd be throwing away.
//   • `diffAssignments` — the roster changes as API operations, since a seat
//     that was only ever added locally has no id to PATCH or DELETE.
import { describeSetlistChange, type SetlistSong } from "./setlist";
import { isUnbounded, type GuestRoleSpec } from "./guestTeams";

// A seat on the set, as the modal holds it. A seat the admin added in this
// session has a locally-generated id (see `newLocalId`) rather than a
// database one — that's what tells an INSERT apart from an UPDATE.
export interface DraftAssignment {
  id: string;
  role: string;
  user: { id: string; name: string };
  // The ApiSetGuestTeam row this seat is borrowed from; null/absent = an
  // ordinary seat on the set's own team.
  guestTeamId?: string | null;
}

const LOCAL_ID_PREFIX = "new:";

/**
 * An id for a row the modal has staged but the server has never seen — a seat
 * the admin just added, or a guest team they just borrowed. The prefix is what
 * tells an INSERT from an UPDATE when the save comes to diff them.
 */
export function newLocalId(): string {
  return `${LOCAL_ID_PREFIX}${Math.random().toString(36).slice(2)}`;
}

/** Whether this row was staged locally rather than loaded from the server. */
export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

/** Everything the modal edits, flattened so two states can be compared. */
export interface SetSnapshot {
  assignments: DraftAssignment[];
  notes: string;
  songs: SetlistSong[];
  // The set's shape, already resolved against its team's catalog.
  capacities: Record<string, number>;
  requiresMD: boolean;
  isPrivate: boolean;
  mdUserId: string | null;
  groupChatLeadDays: number | null;
  guestTeams: { teamId: string; teamName: string; roles: GuestRoleSpec[] }[];
}

/** The roster changes as the three API calls they need. */
export interface AssignmentOps {
  removed: string[]; // DELETE /api/admin/assignments/:id
  reassigned: { id: string; userId: string }[]; // PATCH — same seat, new person
  added: { role: string; userId: string; guestTeamId?: string | null }[]; // POST
}

/**
 * Roster changes between the saved set and the working copy.
 *
 * A seat is matched by id, so swapping the person in a saved seat is an UPDATE
 * (keeping its history), while a seat added and then removed in the same
 * session cancels out entirely — it never reaches the server.
 */
export function diffAssignments(
  before: DraftAssignment[],
  after: DraftAssignment[]
): AssignmentOps {
  const afterById = new Map(after.map((a) => [a.id, a]));
  const beforeById = new Map(before.map((a) => [a.id, a]));

  const removed = before
    .filter((a) => !afterById.has(a.id))
    .map((a) => a.id);

  const reassigned = after
    .filter((a) => {
      const was = beforeById.get(a.id);
      return was && was.user.id !== a.user.id;
    })
    .map((a) => ({ id: a.id, userId: a.user.id }));

  const added = after
    .filter((a) => isLocalId(a.id))
    .map((a) => ({
      role: a.role,
      userId: a.user.id,
      guestTeamId: a.guestTeamId ?? null,
    }));

  return { removed, reassigned, added };
}

/** "7 days before" / "Off" — how a group-chat lead time reads in a change line. */
function leadLabel(days: number | null): string {
  return days === null ? "off" : `${days} day${days === 1 ? "" : "s"} before`;
}

/** One guest team's borrowed roles as a comparable string. */
function guestSummary(roles: GuestRoleSpec[], labelFor: (r: string) => string) {
  return roles
    .map((r) => `${labelFor(r.role)} ${isUnbounded(r) ? "(all available)" : `×${r.count ?? 0}`}`)
    .join(", ");
}

/**
 * What changed, as lines a person can read — the body of the discard warning.
 * Empty array = nothing changed, which is also how the modal decides whether
 * closing needs a confirmation at all.
 *
 * `labelFor` turns a role key into that team's own name for it (roleLabel).
 * `nameFor` resolves a userId for the MD line, whose person may not be seated
 * in the "before" roster at all.
 */
export function describeSetChanges(
  before: SetSnapshot,
  after: SetSnapshot,
  labelFor: (role: string) => string,
  nameFor: (userId: string) => string
): string[] {
  const lines: string[] = [];

  // ── Roster ──────────────────────────────────────────────────────────
  const ops = diffAssignments(before.assignments, after.assignments);
  const beforeById = new Map(before.assignments.map((a) => [a.id, a]));
  const afterById = new Map(after.assignments.map((a) => [a.id, a]));
  // A reassignment is reported as one line, not a remove plus an add.
  for (const r of ops.reassigned) {
    const was = beforeById.get(r.id)!;
    const now = afterById.get(r.id)!;
    lines.push(`${labelFor(now.role)}: ${was.user.name} → ${now.user.name}`);
  }
  for (const id of ops.removed) {
    const a = beforeById.get(id)!;
    lines.push(`Removed ${a.user.name} from ${labelFor(a.role)}`);
  }
  for (const a of after.assignments.filter((x) => isLocalId(x.id))) {
    lines.push(`Added ${a.user.name} on ${labelFor(a.role)}`);
  }

  // ── The set's shape ─────────────────────────────────────────────────
  // Every role either side knows about, so a role added to (or dropped from)
  // the shape is reported rather than silently skipped.
  for (const role of new Set([
    ...Object.keys(before.capacities),
    ...Object.keys(after.capacities),
  ])) {
    const was = before.capacities[role] ?? 0;
    const now = after.capacities[role] ?? 0;
    if (was !== now) lines.push(`${labelFor(role)} slots: ${was} → ${now}`);
  }
  if (before.requiresMD !== after.requiresMD) {
    lines.push(after.requiresMD ? "Now requires an MD" : "No longer requires an MD");
  }

  // ── Guest teams ─────────────────────────────────────────────────────
  const beforeGuests = new Map(before.guestTeams.map((g) => [g.teamId, g]));
  const afterGuests = new Map(after.guestTeams.map((g) => [g.teamId, g]));
  for (const [teamId, g] of afterGuests) {
    const was = beforeGuests.get(teamId);
    if (!was) lines.push(`Borrowing from ${g.teamName}`);
    else if (guestSummary(was.roles, labelFor) !== guestSummary(g.roles, labelFor)) {
      lines.push(`Changed what ${g.teamName} lends`);
    }
  }
  for (const [teamId, g] of beforeGuests) {
    if (!afterGuests.has(teamId)) lines.push(`No longer borrowing from ${g.teamName}`);
  }

  // ── Everything else ─────────────────────────────────────────────────
  if (before.mdUserId !== after.mdUserId) {
    lines.push(
      after.mdUserId
        ? `Musical director: ${nameFor(after.mdUserId)}`
        : "Cleared the musical director"
    );
  }
  // The setlist gets the same one-line summary the history log and Slack use.
  const setlist = describeSetlistChange(before.songs, after.songs);
  if (setlist) lines.push(`Setlist: ${setlist}`);
  if (before.notes.trim() !== after.notes.trim()) {
    lines.push(after.notes.trim() ? "Edited the notes" : "Cleared the notes");
  }
  if (before.isPrivate !== after.isPrivate) {
    lines.push(after.isPrivate ? "Made the set private" : "Made the set visible to the org");
  }
  if (before.groupChatLeadDays !== after.groupChatLeadDays) {
    lines.push(`Auto group chat: ${leadLabel(after.groupChatLeadDays)}`);
  }

  return lines;
}
