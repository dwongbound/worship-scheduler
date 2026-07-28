// Shapes of the JSON our API routes return, as seen by client components.
// (Dates arrive as ISO strings over the wire.)
import type {
  AssignmentStatus,
  Instrument,
  SetHistoryEventType,
  SlotCapacityMap,
} from "./constants";

// An organization (the tenant boundary). GET /api/orgs returns the caller's
// memberships in this shape.
export interface ApiOrg {
  id: string;
  name: string;
  isAdmin: boolean; // MY role in this org
}

// A ministry team (e.g. "Sunday Team") within one org. Sets target one team;
// users belong to any number of them.
export interface ApiTeam {
  id: string;
  name: string;
  // Only present on GET /api/teams (other endpoints embed just {id, name}).
  orgId?: string;
  slackChannelId?: string | null;
}

export interface ApiUserRef {
  id: string;
  name: string;
  isMD?: boolean; // musical director (drives the "* (MD)" marker)
}

export interface ApiAssignment {
  id: string;
  role: Instrument;
  status: AssignmentStatus;
  user: ApiUserRef;
}

export interface ApiSet {
  id: string;
  label: string | null;
  startsAt: string; // ISO datetime
  durationMinutes: number;
  notes: string | null;
  requiresMD: boolean; // set needs a musical director on its team
  // Private ad-hoc set: only org admins + assigned people can see it. The
  // server never returns private sets to anyone else, so this is effectively
  // always visible-to-you when present.
  isPrivate: boolean;
  // The designated MD's userId, or null (none chosen / doesn't require one).
  // Must be an eligible assignee — see lib/md.ts.
  mdUserId: string | null;
  slotCapacities: SlotCapacityMap | null; // null = default team shape
  // The team this set is for (null = open to the whole org, e.g. its team
  // was deleted). Optional because some endpoints return sets without it.
  teamId?: string | null;
  team?: ApiTeam | null;
  // The org the set belongs to (GET /api/sets and /api/swaps include it —
  // drives the org chip when viewing "All orgs").
  org?: { id: string; name: string };
  assignments: ApiAssignment[];
}

// My assignment with its set attached (Swaps tab).
export interface ApiMyAssignment {
  id: string;
  role: Instrument;
  status: AssignmentStatus;
  set: Omit<ApiSet, "assignments">;
  // Present only for PENDING_SWAP rows: the open proposal + whether I started
  // it (so the row can offer Cancel vs. pointing me at my Cover Requests).
  pendingSwap: { proposalId: string; isRequester: boolean } | null;
}

// One set I could trade my assignment into (GET /api/swaps/candidates). Same
// role + team as my slot, currently held by `counterparty`.
export interface ApiSwapCandidate {
  toAssignmentId: string;
  role: Instrument;
  status: AssignmentStatus; // the counterparty's current status
  counterparty: ApiUserRef;
  set: {
    id: string;
    label: string | null;
    startsAt: string;
    durationMinutes: number;
    team: { id: string; name: string } | null;
  };
  youAvailable: boolean; // I'm free for their set's date
  theyAvailable: boolean; // they're free for my set's date
  theyMarkedUnavailable: boolean; // they explicitly blocked my set's date
}

// A pending targeted swap awaiting MY response (GET /api/swaps/proposals/incoming).
export interface ApiIncomingSwap {
  id: string;
  role: Instrument;
  requestedBy: ApiUserRef;
  giveUp: SwapSetRef; // my current set (I'd give this up)
  receive: SwapSetRef; // their set (I'd take this)
}
export interface SwapSetRef {
  id: string;
  label: string | null;
  startsAt: string;
  org: { id: string; name: string };
}

// Someone else's swap request I could take.
export interface ApiSwapRequest {
  id: string;
  role: Instrument;
  user: ApiUserRef;
  set: Omit<ApiSet, "assignments">;
}

// One line in a set's activity log (SetDetailModal's History section).
export interface ApiSetHistoryEvent {
  id: string;
  type: SetHistoryEventType;
  role: Instrument;
  actor: ApiUserRef | null; // null = the auto-scheduler
  targetUser: ApiUserRef | null; // null if that user was later deleted
  previousUser: ApiUserRef | null;
  createdAt: string;
}

export interface ApiUnavailability {
  id: string;
  type: "RECURRING" | "SPECIFIC" | "DATE_RANGE";
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startDate: string | null;
  endDate: string | null;
  // Set for SPECIFIC blocks (the request/TimeRange they belong to).
  requestId: string | null;
  note: string | null;
}

export interface ApiSetTemplate {
  id: string;
  label: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  requiresMD: boolean; // sets from this template need a musical director
  slotCapacities: SlotCapacityMap | null; // null = default team shape
  teamId: string | null; // team the generated sets belong to
  team: ApiTeam | null;
}

// An admin's request for their org to submit availability over a date range.
export interface ApiAvailabilityRequest {
  id: string;
  name: string | null; // optional custom name; null → show the date range
  startDate: string; // ISO date
  endDate: string; // ISO date
  createdAt: string;
  // Present on member-facing endpoints (availability, availability-request)
  // where requests from several orgs mix and need an org chip.
  org?: { id: string; name: string };
}

// GET /api/availability-request: each of my orgs' active request + whether I
// still owe it a response. `needsResponse` = any org still waiting (the dot).
export interface ApiAvailabilityStatus {
  items: { request: ApiAvailabilityRequest; needsResponse: boolean }[];
  needsResponse: boolean;
}

// GET /api/notifications: everything the navbar's reminder dots + banners need,
// in one request. Replaces four parallel badge fetches (swaps, availability,
// profile, teamless). `teamless` is populated only when the query names an org
// the caller administers; otherwise it's an empty list.
export interface ApiNotifications {
  swapCount: number; // open covers + trades awaiting me → the swap dot
  availability: ApiAvailabilityStatus; // the Availabilities dot + banner
  needsInstruments: boolean; // brand-new profile → the "finish setup" dot
  teamless: { id: string; name: string; username: string }[];
}

// A scheduled weekly Slack reminder for one team (Org settings page). Carries
// the team's name + Slack channel so the table can flag teams with no channel.
export interface ApiWeeklyReminder {
  id: string;
  teamId: string;
  teamName: string;
  teamSlackChannelId: string | null;
  dayOfWeek: number; // 0=Sun … 6=Sat
  minute: number; // minutes from midnight (server TZ)
  lastSentAt: string | null;
}

// A user as seen by admins (Create + Users tabs): roles, admin flag, and
// whether they've finished entering availability.
export interface ApiAdminUser {
  id: string;
  name: string;
  username: string; // stable, human-readable deep-link key (?user=<username>)
  isAdmin: boolean;
  isMD: boolean; // can be a set's musical director
  // Whether this person has linked their Slack account in THIS org (drives the
  // Team page's Slack-connected badge). Per-org: they may be linked elsewhere.
  slackConnected: boolean;
  instruments: Instrument[];
  // Teams this person belongs to — gates which sets they can be scheduled on.
  teams: ApiTeam[];
  // Which availability requests this person has marked complete (one row per
  // request). Drives the Availability status panel's per-TimeRange dropdown.
  // completedAt = null → a row that's currently marked "not submitted".
  // edited → re-submitted after having been un-submitted at least once.
  availabilityResponses: {
    requestId: string;
    completedAt: string | null;
    edited: boolean;
  }[];
  // When this person can't serve — used to flag them in the assignment
  // dropdowns for a set at a conflicting time. Dates arrive as ISO strings.
  unavailability: {
    type: "RECURRING" | "SPECIFIC" | "DATE_RANGE";
    dayOfWeek: number | null;
    startMinute: number | null;
    endMinute: number | null;
    startDate: string | null;
    endDate: string | null;
    requestId: string | null;
    note: string | null;
  }[];
}

// ── Staged schedule (Create tab "Generate") ──────────────────────────────
// The auto-scheduler produces a *staged plan* the admin reviews and tweaks
// before committing. Nothing here touches the DB until it's applied via
// POST /api/admin/generate/apply — so no emails/Slack fire during review.

// One proposed person-in-a-role. Names are looked up client-side from the
// admin user list, so only the ids/role travel in the plan.
export interface StagedAssignment {
  userId: string;
  role: Instrument;
}

// A set the generator would create (or fill), with its proposed roster.
export interface StagedSet {
  // Sets are keyed by their start time (unique per occurrence). New sets have
  // no DB id yet, so `startsAt` is the staging identity used by the editor
  // and by apply to match/create the row.
  startsAt: string; // ISO datetime
  label: string | null;
  durationMinutes: number;
  requiresMD: boolean; // set needs a musical director on its team
  // The proposed MD's userId (from lib/md.ts defaultMDId), or null if none.
  mdUserId: string | null;
  slotCapacities: SlotCapacityMap | null; // null = default team shape
  // Team the set belongs to (see ApiSet.teamId). Optional so older plans and
  // test fixtures without a team keep working (= open to everyone).
  teamId?: string | null;
  // True if an (empty) Set row already exists at this time — apply fills it
  // rather than creating a new one. False = apply creates the set.
  existing: boolean;
  assignments: StagedAssignment[];
}

// The full proposal returned by the preview and posted back to apply.
export interface StagedPlan {
  sets: StagedSet[];
  // Sets in the window we left untouched because they're already staffed.
  skipped: number;
}
