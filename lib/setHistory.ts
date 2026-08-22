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
  // Every type except SETLIST_CHANGED has a role; that one returns early below.
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
      return { actor: target, tokens: ["requested a swap for", role] };
    case "SWAP_CANCELED":
      return { actor: target, tokens: ["canceled their swap request for", role] };
    case "SWAP_TAKEN":
      // Now a pending state — the take awaits an admin's approval.
      return {
        actor: target,
        tokens: [
          "took over",
          role,
          "from",
          { name: previous, struck: true },
          "· awaiting approval",
        ],
      };
    case "SWAP_PROPOSED":
      return { actor: target, tokens: ["proposed a swap for", role] };
    case "SWAP_ACCEPTED":
      // The recipient accepted; the trade awaits an admin's approval.
      return {
        actor: target,
        tokens: ["accepted a swap for", role, "· awaiting approval"],
      };
    // Admin decisions on a pending cover/swap (actor = the admin).
    case "APPROVED":
      return { actor, tokens: ["approved the change for", role] };
    case "REJECTED":
      return { actor, tokens: ["rejected the change for", role] };
    // Setlist edits: `detail` already reads as a sentence fragment ("added
    // \"Who Else\" (E)"), so it's the whole of line 2.
    case "SETLIST_CHANGED":
      return {
        actor: event.actor?.name ?? "Someone",
        tokens: [event.detail ?? "changed the setlist"],
      };
  }
}
