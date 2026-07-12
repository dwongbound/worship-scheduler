// Structured description of a SetHistoryEvent. The old version returned a plain
// sentence; now it returns a descriptor so components/SetHistoryEntry.tsx can
// render every person as a chip (struck through when removed/replaced).
import { INSTRUMENT_LABELS } from "./constants";
import type { ApiSetHistoryEvent } from "./types";

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
  const role = INSTRUMENT_LABELS[event.role];
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
      return {
        actor,
        tokens: [
          "swapped in",
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
      return {
        actor: target,
        tokens: ["took over", role, "from", { name: previous, struck: true }],
      };
  }
}
