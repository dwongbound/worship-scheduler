// Shapes of the JSON our API routes return, as seen by client components.
// (Dates arrive as ISO strings over the wire.)
import type {
  AssignmentStatus,
  Instrument,
  SlotCapacityMap,
} from "./constants";

export interface ApiUserRef {
  id: string;
  name: string;
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
  slotCapacities: SlotCapacityMap | null; // null = default team shape
  assignments: ApiAssignment[];
}

// My assignment with its set attached (Swaps tab).
export interface ApiMyAssignment {
  id: string;
  role: Instrument;
  status: AssignmentStatus;
  set: Omit<ApiSet, "assignments">;
}

// Someone else's swap request I could take.
export interface ApiSwapRequest {
  id: string;
  role: Instrument;
  user: ApiUserRef;
  set: Omit<ApiSet, "assignments">;
}

export interface ApiUnavailability {
  id: string;
  type: "RECURRING" | "DATE_RANGE";
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
}

export interface ApiSetTemplate {
  id: string;
  label: string;
  dayOfWeek: number;
  startMinute: number;
  durationMinutes: number;
  slotCapacities: SlotCapacityMap | null; // null = default team shape
}

// An admin's request for the team to submit availability over a date range.
export interface ApiAvailabilityRequest {
  id: string;
  name: string | null; // optional custom name; null → show the date range
  startDate: string; // ISO date
  endDate: string; // ISO date
  createdAt: string;
}

// A user as seen by admins (Create + Users tabs): roles, admin flag, and
// whether they've finished entering availability.
export interface ApiAdminUser {
  id: string;
  name: string;
  isAdmin: boolean;
  instruments: Instrument[];
  scheduleCompletedAt: string | null;
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
  slotCapacities: SlotCapacityMap | null; // null = default team shape
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
