// Pure helpers for the calendar's "Preview Mode" (admin, desktop only).
//
// Preview Mode reuses the Create tab's review workspace (StagedScheduleModal)
// as a READ-ONLY-ish lens on what's ALREADY on the calendar: instead of a
// generated proposal, the staged plan is built from the real sets and their
// real rosters. Nothing here ever reaches an API — the plan is never applied —
// so this file only has to answer two questions:
//
//   1. Which "type of set" is each calendar set? — the preview's options
//      dialog offers one checkbox per recurring set (SetTemplate) plus an
//      "Other" bucket for everything else (private sets, one-offs, sets whose
//      template was renamed or deleted). See `setTypeOf`.
//   2. What does a real ApiSet look like as a StagedSet? — see `toStagedSet`.
//
// Kept prisma/react-free so it's trivially unit-testable
// (tests/unit/calendarPreview.test.ts).
import { zonedParts } from "./dates";
import type { AssignmentOps } from "./setDraft";
import type { ApiSet, ApiSetTemplate, StagedSet } from "./types";

/**
 * The pseudo-template id for sets that came from no recurring set. It's a real
 * key rather than `null` so the "Other" bucket can be ticked and TINTED like
 * any other type — StagedScheduleModal looks its colour up by `templateId`.
 * A SetTemplate id is a cuid, so this can never collide with one.
 */
export const OTHER_SET_TYPE = "other";

/** One row of the preview options dialog. */
export interface PreviewSetType {
  // A SetTemplate id, or OTHER_SET_TYPE.
  id: string;
  label: string;
  // The recurrence, for the "Sun 6:45AM" hint. Null on the "Other" row, which
  // is a bucket rather than a schedule.
  dayOfWeek: number | null;
  startMinute: number | null;
  team: { id: string; name: string } | null;
  // How many sets currently on the calendar fall under this type — so an
  // admin picks from what's actually there, not from a list of empty options.
  count: number;
}

/** A set's team id, wherever the endpoint happened to put it. */
function teamIdOf(set: ApiSet): string | null {
  return set.teamId ?? set.team?.id ?? null;
}

/**
 * Whether `set` looks like an occurrence of `template`: same name, same team,
 * and landing on the recurrence's weekday and time.
 *
 * ApiSet carries no templateId (the generator expands templates into ordinary
 * Sets and forgets the link), so the match is by shape. It's read in the app's
 * timezone for the same reason availability is — a weekday-plus-minutes
 * recurrence only means something against the church's clock, never the
 * admin's (see lib/appTz.ts).
 */
function matchesTemplate(
  set: ApiSet,
  template: ApiSetTemplate,
  timeZone?: string
): boolean {
  if ((set.label ?? null) !== template.label) return false;
  if (teamIdOf(set) !== (template.teamId ?? null)) return false;
  const at = zonedParts(new Date(set.startsAt), timeZone);
  return (
    at.weekday === template.dayOfWeek && at.minuteOfDay === template.startMinute
  );
}

/**
 * Which type a set belongs to: the id of the first recurring set it looks like
 * an occurrence of, else OTHER_SET_TYPE.
 */
export function setTypeOf(
  set: ApiSet,
  templates: ApiSetTemplate[],
  timeZone?: string
): string {
  return (
    templates.find((t) => matchesTemplate(set, t, timeZone))?.id ??
    OTHER_SET_TYPE
  );
}

/**
 * The checkbox rows for the options dialog: every recurring set that has at
 * least one of `sets` under it (in the templates' own order), then "Other" if
 * anything is left over. Types with nothing in the window are dropped — there'd
 * be nothing to preview behind the tick.
 */
export function previewSetTypes(
  sets: ApiSet[],
  templates: ApiSetTemplate[],
  timeZone?: string
): PreviewSetType[] {
  const counts = new Map<string, number>();
  for (const set of sets) {
    const id = setTypeOf(set, templates, timeZone);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const rows: PreviewSetType[] = templates
    .filter((t) => counts.has(t.id))
    .map((t) => ({
      id: t.id,
      label: t.label,
      dayOfWeek: t.dayOfWeek,
      startMinute: t.startMinute,
      team: t.team ? { id: t.team.id, name: t.team.name } : null,
      count: counts.get(t.id) ?? 0,
    }));

  const other = counts.get(OTHER_SET_TYPE) ?? 0;
  if (other > 0) {
    rows.push({
      id: OTHER_SET_TYPE,
      label: "Other",
      dayOfWeek: null,
      startMinute: null,
      team: null,
      count: other,
    });
  }
  return rows;
}

/**
 * A real calendar set as the review workspace's staged shape, roster and all.
 *
 * `existing` is always true (every one of these is on the calendar already) and
 * `stagingId` is the set's real id, so two sets that start at the same instant
 * — a Sunday service and a prayer meeting at 9am — stay distinct rows.
 *
 * Guest-team seats are dropped: a borrowed seat belongs to the LENDING team's
 * role catalog, which the staged card (built from the owning team's roles)
 * has no column for. The preview shows the set's own roster.
 */
export function toStagedSet(
  set: ApiSet,
  templates: ApiSetTemplate[],
  timeZone?: string
): StagedSet {
  return {
    stagingId: set.id,
    startsAt: set.startsAt,
    label: set.label,
    durationMinutes: set.durationMinutes,
    requiresMD: set.requiresMD,
    mdUserId: set.mdUserId,
    slotCapacities: set.slotCapacities,
    groupChatLeadDays: set.groupChatLeadDays ?? null,
    teamId: teamIdOf(set),
    templateId: setTypeOf(set, templates, timeZone),
    existing: true,
    assignments: set.assignments
      .filter((a) => !a.guestTeamId)
      // The row id rides along so a SAVE can tell "same seat, new person"
      // (an update) from "a seat that wasn't there" (an insert).
      .map((a) => ({ userId: a.user.id, role: a.role, assignmentId: a.id })),
  };
}

/**
 * The sets Preview Mode offers: the ones already loaded by the calendar, in
 * ONE org (the admin org — templates and team catalogs are per-org) and from
 * `now` onward. History is left out on purpose: the workspace is a planning
 * view, and the calendar's window reaches months into the past, which would
 * bury the upcoming sets and skew the team-load bars with sets nobody can
 * change.
 */
export function previewCandidates(
  sets: ApiSet[],
  orgId: string,
  now: Date = new Date()
): ApiSet[] {
  const from = now.getTime();
  return sets
    .filter((s) => s.org?.id === orgId && new Date(s.startsAt).getTime() >= from)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * The staged plan behind Preview Mode: the picked types' sets, in date order.
 * `skipped` is 0 — nothing is being generated, so nothing was passed over.
 */
export function buildPreviewPlan(
  sets: ApiSet[],
  templates: ApiSetTemplate[],
  pickedTypeIds: string[],
  timeZone?: string
): { sets: StagedSet[]; skipped: number } {
  const picked = new Set(pickedTypeIds);
  return {
    sets: sets
      .filter((s) => picked.has(setTypeOf(s, templates, timeZone)))
      .map((s) => toStagedSet(s, templates, timeZone)),
    skipped: 0,
  };
}

/**
 * One set's worth of work a preview SAVE has to do.
 *
 * `ops` is exactly what PATCH /api/admin/sets/:id/roster takes (the same shape
 * the set detail modal posts). `mdUserId` is present only when the admin
 * changed it — it's a separate request (PATCH /api/sets/:id), and one that has
 * to run AFTER the roster, since applying a roster can re-derive the MD.
 */
export interface PreviewSetSave {
  setId: string;
  ops: AssignmentOps;
  mdUserId?: string | null;
}

/**
 * What changed between the preview as it opened and the preview as it stands —
 * one entry per set that actually differs, so a save touches nothing the admin
 * didn't edit.
 *
 * Seats are matched by their real assignment id: keeping the id and changing
 * the person is a REASSIGNMENT (the seat keeps its history), a staged seat with
 * no id is an ADDITION, and an id that's gone is a REMOVAL. Guest-team seats
 * were never staged (see `toStagedSet`), so they're not in `before` and can
 * never be diffed away.
 *
 * Doubling as the dirty check: an empty result means there is nothing to save,
 * which is also what says whether leaving needs a confirmation.
 */
export function previewSaves(
  before: StagedSet[],
  after: StagedSet[]
): PreviewSetSave[] {
  const beforeById = new Map(
    before.flatMap((s) => (s.stagingId ? [[s.stagingId, s] as const] : []))
  );
  const saves: PreviewSetSave[] = [];

  for (const now of after) {
    const setId = now.stagingId;
    if (!setId) continue; // no real row behind it — nothing to save onto
    const was = beforeById.get(setId);
    if (!was) continue;

    const wasSeats = new Map(
      was.assignments.flatMap((a) =>
        a.assignmentId ? [[a.assignmentId, a] as const] : []
      )
    );
    const nowIds = new Set(
      now.assignments.flatMap((a) => (a.assignmentId ? [a.assignmentId] : []))
    );

    const ops: AssignmentOps = {
      removed: [...wasSeats.keys()].filter((id) => !nowIds.has(id)),
      reassigned: now.assignments.flatMap((a) => {
        if (!a.assignmentId) return [];
        const seat = wasSeats.get(a.assignmentId);
        return seat && seat.userId !== a.userId
          ? [{ id: a.assignmentId, userId: a.userId }]
          : [];
      }),
      added: now.assignments.flatMap((a) =>
        a.assignmentId ? [] : [{ role: a.role, userId: a.userId }]
      ),
    };

    const mdChanged = (now.mdUserId ?? null) !== (was.mdUserId ?? null);
    const rosterChanged =
      ops.removed.length + ops.reassigned.length + ops.added.length > 0;
    if (!rosterChanged && !mdChanged) continue;

    saves.push({
      setId,
      ops,
      ...(mdChanged ? { mdUserId: now.mdUserId ?? null } : {}),
    });
  }

  return saves;
}

/**
 * A preview's pending changes as one sentence, for the "you have unsaved
 * changes" confirmation — so leaving is never a surprise about how much.
 */
export function describePreviewSaves(saves: PreviewSetSave[]): string {
  let seats = 0;
  let mds = 0;
  for (const s of saves) {
    seats +=
      s.ops.removed.length + s.ops.reassigned.length + s.ops.added.length;
    if ("mdUserId" in s) mds++;
  }
  const parts = [
    `${seats} roster change${seats === 1 ? "" : "s"}`,
    ...(mds > 0 ? [`${mds} MD change${mds === 1 ? "" : "s"}`] : []),
  ];
  return `${parts.join(" and ")} across ${saves.length} set${
    saves.length === 1 ? "" : "s"
  }`;
}
