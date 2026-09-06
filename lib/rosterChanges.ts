// One roster save, described in words.
//
// The set detail modal used to apply its roster edits one HTTP request at a
// time, and each of those requests posted its own line to the set's Slack group
// chat. Auto-filling an empty set therefore fired eight round trips and eight
// separate "X was added on Y" messages — a wall of notifications for what the
// admin experienced as a single click on Save.
//
// The batch endpoint (PATCH /api/admin/sets/:id/roster) applies the whole diff
// at once and posts ONE notice built here. Pure, so it's unit-tested without a
// database (tests/unit/rosterChanges.test.ts).

/** One seat that changed, in the order the endpoint applied them. */
export interface RosterChange {
  kind: "added" | "removed" | "reassigned";
  /** Role key — turned into that team's own label by `labelFor`. */
  role: string;
  /** Who holds the seat now (added/reassigned) or who left it (removed). */
  name: string;
  /** Reassigned only: who held it before. */
  previousName?: string;
}

// Per-kind prefix, matching the emoji the one-at-a-time notices used so the
// grouped message still reads like the same feed.
const MARKS: Record<RosterChange["kind"], string> = {
  added: "\u{2795}", // ➕
  removed: "\u{2796}", // ➖
  reassigned: "\u{1F501}", // 🔁
};

/**
 * The group-chat notice for a batch of roster changes, or null when there's
 * nothing to say (so the caller can skip posting entirely).
 *
 * A single change reads as its own sentence, exactly as it did before the
 * batching — one line for one change is not worth a header. Several are
 * gathered under one, so the chat gets a single message per save.
 */
export function describeRosterChanges(
  changes: RosterChange[],
  labelFor: (role: string) => string
): string | null {
  if (changes.length === 0) return null;

  const line = (c: RosterChange): string => {
    const role = labelFor(c.role);
    if (c.kind === "added") return `${MARKS.added} ${c.name} was added on ${role}.`;
    if (c.kind === "removed") {
      return `${MARKS.removed} ${c.name} is no longer on ${role}.`;
    }
    return `${MARKS.reassigned} ${role}: ${c.name} is now covering for ${c.previousName}.`;
  };

  if (changes.length === 1) return line(changes[0]);

  // Header + one line each. The count is in the header so a reader can tell at
  // a glance whether this was a tweak or a whole re-roster.
  return [
    `\u{1F39A}\u{FE0F} Roster update — ${changes.length} changes:`,
    ...changes.map((c) => line(c)),
  ].join("\n");
}
