// The MCP tools an access key gets: one per section of the snapshot, plus the
// whole thing, and, for a key made "can act for me", four that write.
// Declared here (not in the route) because a route.ts may only export Next's
// own handlers, and the unit test pins the list.
import type { McpTool } from "./mcp";

/** The snapshot's sections (lib/agentSnapshot.ts), one tool each. */
export const AGENT_SECTIONS = ["mySets", "schedule", "covers", "availability"] as const;
export type AgentSection = (typeof AGENT_SECTIONS)[number];

export interface AgentTool extends McpTool {
  /** The snapshot section it returns; null = all of them. */
  section: AgentSection | null;
}

export const AGENT_TOOLS: AgentTool[] = [
  {
    name: "get_tapworship_snapshot",
    title: "Everything at once",
    description:
      "All of the below in one call: the person's own upcoming sets, the next 30 days of sets in their orgs, covers they could take, and their availability requests.",
    section: null,
  },
  {
    name: "get_my_sets",
    title: "My sets",
    description:
      "The sets the person is playing in the next 60 days: when, the role(s) they hold and each seat's status (with the assignmentId the writing tools take), who else is playing, the musical director, the songs with their keys, and practices. `needsYourConfirmation` marks a set they haven't confirmed.",
    section: "mySets",
  },
  {
    name: "get_schedule",
    title: "Upcoming schedule",
    description:
      "Every set in the person's orgs for the next 30 days that they can see in the app, with its roster, songs and practices.",
    section: "schedule",
  },
  {
    name: "get_open_covers",
    title: "Covers I could take",
    description:
      "Upcoming seats someone has asked to be covered that this person could take (a role they play on that team), with who asked and why. Each has the assignmentId take_cover takes.",
    section: "covers",
  },
  {
    name: "get_availability_requests",
    title: "Availability requests",
    description:
      "Each org's current availability request aimed at this person, and whether they still need to fill it in. Filling it in happens in the app (the link), not here.",
    section: "availability",
  },
];

/** What a writing tool does: the MCP route maps each to one app route. */
export type AgentAction = "confirm" | "requestSwap" | "cancelSwap" | "take";

export interface AgentWriteTool extends McpTool {
  action: AgentAction;
}

const ASSIGNMENT_ID = {
  type: "string",
  description: "The seat's assignmentId, from get_my_sets (yourSeats) or get_open_covers.",
};

export const AGENT_WRITE_TOOLS: AgentWriteTool[] = [
  {
    name: "confirm_set",
    title: "Confirm a set",
    description:
      "Confirm one of the person's own seats (an assignmentId from get_my_sets), exactly as the Confirm button on My Sets does. Read the set and role back to them before calling.",
    action: "confirm",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { assignmentId: ASSIGNMENT_ID },
      required: ["assignmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "request_cover",
    title: "Ask for cover",
    description:
      "Put one of the person's own seats up for cover, as My Sets' Request cover does: everyone who could take it is messaged. The seat stays theirs until someone takes it and an admin approves. Confirm with the person first.",
    action: "requestSwap",
    readOnly: false,
    destructive: true,
    inputSchema: {
      type: "object",
      properties: {
        assignmentId: ASSIGNMENT_ID,
        reason: { type: "string", description: "Optional note shown to whoever could cover, e.g. \"out of town\"." },
      },
      required: ["assignmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_cover_request",
    title: "Withdraw a cover request",
    description:
      "Take back a cover request on one of the person's own seats. The seat goes back to not confirmed, so ask whether to confirm_set it too.",
    action: "cancelSwap",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { assignmentId: ASSIGNMENT_ID },
      required: ["assignmentId"],
      additionalProperties: false,
    },
  },
  {
    name: "take_cover",
    title: "Take a cover",
    description:
      "Take someone else's open cover (an assignmentId from get_open_covers), as the Take button does: the seat moves to the person and waits on an admin's approval. Read the set, date and role back to them before calling.",
    action: "take",
    readOnly: false,
    inputSchema: {
      type: "object",
      properties: { assignmentId: ASSIGNMENT_ID },
      required: ["assignmentId"],
      additionalProperties: false,
    },
  },
];

/** The tools a key lists: the readers always, the writers only when it may write. */
export function agentToolsFor(canWrite: boolean): McpTool[] {
  if (canWrite) return [...AGENT_TOOLS, ...AGENT_WRITE_TOOLS];
  return AGENT_TOOLS;
}

const READ_ONLY_INSTRUCTIONS =
  "Access to one person's view of TapWorship (tapworship.com), the app their church uses to schedule worship teams: " +
  "the sets they are playing, their orgs' upcoming schedule with rosters, songs and practices, covers they could take, and their availability requests. " +
  "Times are ISO instants; show them in the church's time zone (America/Los_Angeles) unless told otherwise. ";

/** Shown once at initialize; says what this particular key may do. */
export function agentInstructions(canWrite: boolean): string {
  if (!canWrite) {
    return (
      READ_ONLY_INSTRUCTIONS +
      "This key is read-only: nothing here can confirm, swap or change anything; send the person to the app (the links) for that."
    );
  }
  return (
    READ_ONLY_INSTRUCTIONS +
    "This key may also confirm the person's own sets, ask for cover on them, withdraw that ask, and take someone else's open cover, as the person. " +
    "Confirm what you are about to do with the person before every write. Nothing here can change a roster, availability, or anything an admin does."
  );
}
