// Structured description of a SetHistoryEvent. The old version returned a plain
// sentence; now it returns a descriptor so components/SetHistoryEntry.tsx can
// render every person as a chip (struck through when removed/replaced).
import type { ApiSetHistoryEvent } from "./types";
import { roleLabel } from "./teamRoles";

// A line-2 token: a plain string is muted connective text ("added", "for
// Drums"…); an object is a person chip, optionally struck through.
export type HistoryToken = string | { name: string; struck?: boolean };

export interface SetHistoryDescriptor {
  actor: string; // line-1 chip: who performed the action
  actorMuted?: boolean; // true for the auto-scheduler (a system chip, not a person)
  tokens: HistoryToken[]; // line-2 detail, in reading order
}

export function describeSetHistoryEvent(
  event: ApiSetHistoryEvent
): SetHistoryDescriptor {
  // Every type except the set-level ones (SETLIST_CHANGED, NOTES_CHANGED) has
  // a role; those two return early below.
  const role = event.role ? roleLabel(event.role) : "";
  const target = event.targetUser?.name ?? "Someone";
  const previous = event.previousUser?.name ?? "someone";
  const actor = event.actor?.name ?? "An admin";

  switch (event.type) {
    case "ADDED":
      // Admin-added vs auto-scheduled (no actor).
      return event.actor
        ? { actor, tokens: ["added", { name: target }, `as ${role}`] }
        : {
            actor: "Auto-scheduler",
            actorMuted: true,
            tokens: ["scheduled", { name: target }, `as ${role}`],
          };
    case "REMOVED":
      return {
        actor,
        tokens: ["removed", { name: target, struck: true }, `from ${role}`],
      };
    case "REASSIGNED":
      // No verb needed — the new chip + struck-through old chip already read as
      // a swap, and the actor is shown up on the date line.
      return {
        actor,
        tokens: [
          { name: target },
          "for",
          { name: previous, struck: true },
          `· ${role}`,
        ],
      };
    // Self-service events: the target is the one who acted, so they're the
    // line-1 chip and line 2 is just the action + role.
    case "CONFIRMED":
      return { actor: target, tokens: ["confirmed", role] };
    case "SWAP_REQUESTED":
      // `detail` is the note they left when asking (the same one the Slack DM
      // quotes). Shown when there is one, so the log answers "why" too.
      return {
        actor: target,
        tokens: event.detail
          ? ["requested cover for", role, `· "${event.detail}"`]
          : ["requested cover for", role],
      };
    case "SWAP_CANCELED":
      // "Cover", not "swap", to match the filter label and the request line.
      return { actor: target, tokens: ["canceled their cover request for", role] };
    case "SWAP_TAKEN":
      // Now a pending state — the take awaits an admin's approval. Worded like
      // the Slack DM ("<name> is covering your <role> slot") so the log and the
      // notification describe the same moment the same way.
      return {
        actor: target,
        tokens: [
          "is covering",
          role,
          "for",
          { name: previous, struck: true },
          "· awaiting approval",
        ],
      };
    case "SWAP_PROPOSED":
      return { actor: target, tokens: ["proposed a swap for", role] };
    case "SWAP_ACCEPTED":
      // The recipient accepted; the trade awaits an admin's approval. The row
      // knows the other party, so name them rather than saying "a swap".
      return {
        actor: target,
        tokens: event.previousUser
          ? [
              "accepted a swap with",
              { name: previous },
              `· ${role} · awaiting approval`,
            ]
          : ["accepted a swap for", role, "· awaiting approval"],
      };
    // Admin decisions on a pending cover/swap (actor = the admin).
    //
    // A cover decision carries both people (the taker and the owner they took
    // it from); a targeted swap's decision carries neither, so the presence of
    // those chips is what tells the two apart. Naming them matches the detail
    // the admin's own approval DM gave them.
    case "APPROVED":
      return event.targetUser && event.previousUser
        ? {
            actor,
            tokens: [
              "approved",
              { name: target },
              "covering for",
              { name: previous, struck: true },
              `· ${role}`,
            ],
          }
        : { actor, tokens: ["approved the swap for", role] };
    case "REJECTED":
      // On a rejected cover the slot went BACK to its owner, so the taker
      // (previousUser here) is the struck chip — they're the one who lost it.
      return event.targetUser && event.previousUser
        ? {
            actor,
            tokens: [
              "rejected",
              { name: previous, struck: true },
              "covering for",
              { name: target },
              `· ${role}`,
            ],
          }
        : { actor, tokens: ["rejected the swap for", role] };
    // Setlist edits: `detail` already reads as a sentence fragment ("added
    // \"Who Else\" (E)"), so it's the whole of line 2.
    case "SETLIST_CHANGED":
      return {
        actor: event.actor?.name ?? "Someone",
        tokens: [event.detail ?? "changed the setlist"],
      };
    // Notes edits, same shape: `detail` already reads as a fragment and
    // carries an excerpt of what was written (see lib/setNotes.ts).
    case "NOTES_CHANGED":
      return {
        actor: event.actor?.name ?? "Someone",
        tokens: [event.detail ?? "changed the notes"],
      };
  }
}
