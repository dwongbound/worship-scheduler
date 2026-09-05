// Shapes of the JSON our API routes return, as seen by client components.
// (Dates arrive as ISO strings over the wire.)
import type {
  AssignmentStatus,
  Instrument,
  SetHistoryEventType,
  SlotCapacityMap,
} from "./constants";
import type { TeamRoleDef } from "./teamRoles";
import type { GuestRoleSpec } from "./guestTeams";

// Re-exported so client components can type a catalog without reaching past
// the Api* shapes they already import.
export type { TeamRoleDef };

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
  // The team's standing Slack channel for weekly summaries (per-set auto group
  // chats are configured on the set/template, not here).
  slackChannelId?: string | null;
  // This team's role catalog, in order — what roles exist HERE, how many of
  // each a set wants by default, and which are admin-only. Present wherever the
  // client needs to render roles (GET /api/teams, and each set's team);
  // absent = fall back to the built-in defaults.
  roles?: TeamRoleDef[];
}

export interface ApiUserRef {
  id: string;
  name: string;
  isMD?: boolean; // musical director (drives the "* (MD)" marker)
}

// One team a person serves on plus the roles they play ON THAT team (roles are
// per-team now). Embedded in ApiMe (their own) and ApiAdminUser (as an admin
// sees each member). `orgId` is present on ApiMe's copy so the profile page can
// group a person's teams by org.
export interface ApiTeamRole {
  id: string;
  name: string;
  orgId?: string;
  roles: Instrument[];
  // The team's own role catalog — what it offers, as opposed to `roles` above,
  // which is what THIS person plays here. Present on GET /api/me (the profile's
  // picker needs it); absent elsewhere, where the page already has the team.
  catalog?: TeamRoleDef[];
  // Whether this person is schedulable on THIS team (per-team, so someone can
  // be active on one team and inactive on another). Inactive people are never
  // auto-scheduled and read as "(inactive)" in the pick + swap lists.
  active: boolean;
}

export interface ApiAssignment {
  id: string;
  role: Instrument;
  status: AssignmentStatus;
  user: ApiUserRef;
  // Set when this seat was borrowed from a guest team — the ApiSetGuestTeam.id
  // it belongs to. Null/absent = an ordinary seat on the set's own team. Role
  // keys are only unique within a team, so this is what tells a guest CHOIR
  // seat apart from the owning team's own CHOIR seat.
  guestTeamId?: string | null;
}

// One team lending its people to a set (see lib/guestTeams.ts). `roles` says
// which of THAT team's roles this set borrows and how many of each.
export interface ApiSetGuestTeam {
  id: string;
  teamId: string;
  roles: GuestRoleSpec[];
  // The guest team itself, with its own catalog — the borrowed seats are
  // labelled and filled from this, not from the owning team's roles.
  team: ApiTeam;
}

// One song in a set's setlist (see the Song model). `key` is one of SONG_KEYS
// or null (unspecified); `order` is the 0-based position in the list.
export interface ApiSong {
  id: string;
  title: string;
  key: string | null;
  order: number;
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
  // Auto-create the set's private Slack channel this many days before it starts
  // (null = off). See Set.groupChatLeadDays.
  groupChatLeadDays?: number | null;
  // The team this set is for (null = open to the whole org, e.g. its team
  // was deleted). Optional because some endpoints return sets without it.
  teamId?: string | null;
  team?: ApiTeam | null;
  // The org the set belongs to (GET /api/sets and /api/swaps include it —
  // drives the org chip when viewing "All orgs").
  org?: { id: string; name: string };
  assignments: ApiAssignment[];
  // Teams lending people to this set (see lib/guestTeams.ts). Present on
  // GET /api/sets; absent on endpoints that don't include it.
  guestTeams?: ApiSetGuestTeam[];
  // The worship leader's setlist, ordered. Present on GET /api/sets; may be
  // absent (undefined) on endpoints that don't include it.
  songs?: ApiSong[];
  // The set's collaborative Spotify playlist, once created (null before then).
  spotifyPlaylistUrl?: string | null;
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
  theyInactive: boolean; // they're marked inactive on this set's team
}

// A pending targeted swap awaiting MY response (GET /api/swaps/proposals/incoming).
export interface ApiIncomingSwap {
  id: string;
  role: Instrument;
  requestedBy: ApiUserRef;
  reason: string | null; // the proposer's optional note
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
  reason: string | null; // the owner's optional cover note
  set: Omit<ApiSet, "assignments">;
}

// One line in a set's activity log (SetDetailModal's History section).
export interface ApiSetHistoryEvent {
  id: string;
  type: SetHistoryEventType;
  // Null for the set-level events (SETLIST_CHANGED, NOTES_CHANGED) — those are
  // about the songs/notes, not a slot.
  role: Instrument | null;
  // Human summary, for SETLIST_CHANGED and NOTES_CHANGED.
  detail: string | null;
  actor: ApiUserRef | null; // null = the auto-scheduler
  targetUser: ApiUserRef | null; // null if that user was later deleted
  previousUser: ApiUserRef | null;
  createdAt: string;
}

// One row of the org-wide Team Activity log (GET /api/admin/activity): a set
// history event plus which set/team it happened on.
export interface ApiActivityEvent extends ApiSetHistoryEvent {
  set: { id: string; label: string | null; startsAt: string };
  teamName: string | null;
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
  // Present on the admin endpoint: the teams this request was aimed at — only
  // their members are asked to fill it in. Empty = the whole org (older
  // requests, and orgs with no teams). See lib/availabilityTargets.ts.
  teams?: { id: string; name: string }[];
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
  needsRoles: boolean; // no roles on any team yet → the "finish setup" dot
  teamless: { id: string; name: string; username: string }[];
  approvalCount: number; // pending cover/swap approvals in the admin org → dot
}

// One item on the admin Approvals tab (GET /api/admin/approvals). A cover-take
// or a targeted swap that's been accepted/taken and now needs admin sign-off.
export interface ApiApprovalSwap {
  kind: "swap";
  id: string; // proposal id
  role: Instrument;
  reason: string | null;
  createdAt: string;
  requester: ApiUserRef;
  recipient: ApiUserRef;
  receive: SwapSetRef; // requester's set, now the recipient's
  giveUp: SwapSetRef; // recipient's set, now the requester's
}
export interface ApiApprovalCover {
  kind: "cover";
  id: string; // assignment id
  role: Instrument;
  reason: string | null;
  createdAt: string;
  taker: ApiUserRef;
  originalOwner: ApiUserRef | null;
  set: SwapSetRef;
}
export type ApiApproval = ApiApprovalSwap | ApiApprovalCover;

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
  // The actual Slack member id for THIS org (null = unset). Admins can edit it
  // from the Team page; used to prefill that inline editor.
  slackUserId: string | null;
  // When true, this person is added to every Slack group chat this org creates,
  // even for sets they aren't on (per-org membership flag).
  alwaysInGroupChats: boolean;
  // Teams this person belongs to, each with the roles they play there — gates
  // which sets/roles they can be scheduled on. Roles are per-team now.
  teams: ApiTeamRole[];
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
  // dropdowns for a set at a conflicting time, and drawn as a read-only month
  // in the Create tab's availability modal. Dates arrive as ISO strings.
  unavailability: ApiUnavailability[];
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
  // True when an admin hand-picked this person for this slot in the review
  // modal. Locked slots are HARD constraints for a re-run of "Auto schedule"
  // (they ride along as scheduler `preAssigned`); everything else is thrown
  // away and re-proposed. Clearing the slot (picking "None") drops the lock
  // with the assignment. Never persisted — apply only reads userId/role.
  locked?: boolean;
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
  // Per-set auto group-chat lead time inherited from the template (days before
  // start; null = off). Baked onto the created set at apply time.
  groupChatLeadDays?: number | null;
  // Team the set belongs to (see ApiSet.teamId). Optional so older plans and
  // test fixtures without a team keep working (= open to everyone).
  teamId?: string | null;
  // Which recurring set (SetTemplate) this occurrence was expanded from. Used
  // by the review modal to tint a set type's cards with the colour picked in
  // the options dialog; apply ignores it. Optional for the same reason teamId
  // is — older plans and fixtures predate it.
  templateId?: string | null;
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
  // The balancing state the server's fill started from, shipped so the review
  // modal's "Auto schedule all" can re-run the SAME pure algorithm over the
  // SAME inputs (see lib/scheduler.ts). Without it a client-side re-fill would
  // start every tally at zero and quietly undo the load balancing.
  // Optional so older plans and test fixtures keep type-checking.
  baseline?: {
    // userId → assignments already on the books (upcoming, cross-org).
    counts: Record<string, number>;
    // teamKey(userId, teamId) → the same, split by team.
    teamCounts: Record<string, number>;
    // Dates people are already booked on, for the spacing rule.
    booked: { userId: string; startsAt: string }[];
  };
}

// One membership row as GET /api/me returns it — the per-org fields the
// profile/org-settings pages read (Slack link status, admin flag). Distinct
// from ApiOrg: this is the shape hung off the current user, not the org list.
export interface ApiMeMembership {
  orgId: string;
  orgName: string;
  isAdmin: boolean;
  slackUserId: string | null;
  // Whether the ORG has connected Slack (bot installed).
  orgSlackConnected: boolean;
  slackTeamName: string | null;
  // Whether the ORG has connected its shared Spotify account, + the account's
  // display name (cosmetic, shown on the org settings page).
  orgSpotifyConnected: boolean;
  spotifyDisplayName: string | null;
  // The connected account's Spotify user id — the label's fallback when the
  // account has no display_name set.
  spotifyUserId: string | null;
}

// The current user's own profile — GET /api/me. Fetched once by AuthGate and
// shared via MeProvider so the profile/org-settings pages don't refetch it.
export interface ApiMe {
  username: string;
  name: string;
  email: string | null;
  // Whether a usable password hash exists (OAuth-only accounts have none).
  hasPassword: boolean;
  // Opt-in (default on) to the daily 8 AM Slack digest — see lib/digest.ts.
  dailyDigest: boolean;
  memberships: ApiMeMembership[];
  // Teams this person serves on, each with the roles they've picked there and
  // the owning org (roles are per-team; the profile page edits them).
  teams: ApiTeamRole[];
}
