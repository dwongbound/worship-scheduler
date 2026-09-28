"use client";
// Review step for the Create tab's "Generate" flow. The scheduler proposes a
// plan (POST /api/admin/generate, a dry run); this modal lets the admin move
// people around before committing. Every edit here is LOCAL state — nothing
// is saved (and no emails/Slack fire) until "Apply schedule" posts the final
// plan to /api/admin/generate/apply.
//
// Layout: a near-full-screen workspace. A "Team load" panel across the top
// shows who is playing how often (so the admin can spot over/under-used
// people at a glance); below it, the occurrence cards, grouped either way by
// the toggle in the modal's header (left of the ✕, so scrolling the cards
// can't take it away — and a size up in preview mode, where re-reading the
// season a different way is the main thing you came to do):
//   • By set type — one horizontally-scrolling row per recurring set, so you
//     read one set type's rotation across the weeks.
//   • Chronological — one row per WEEK, weeks running down the page, so you
//     read the calendar as it actually happens: everything in that week side
//     by side (Tuesday morning, Tuesday evening, Thursday…), then the next
//     week below. The date axis pivots from "across the weeks" to "down the
//     weeks".
// Every roster dropdown is availability-aware — people who can't serve at a
// set's time are flagged and sorted last (same PlayerSelect the calendar's
// SetDetailModal uses).
//
// LOCKING: picking someone by hand LOCKS them into that slot (indigo box + a
// 🔒 marker). Re-running "Auto schedule" keeps every locked slot exactly as it
// is and re-proposes only the rest, so the admin can pin the two or three
// people they care about and let the algorithm redo the rest around them.
// Clearing a slot (picking "None") — or clicking its 🔒 — releases the lock.
//
// COLOURS: the options dialog can tint each recurring set; those tints arrive
// as `colors` (templateId → hex) and paint the matching cards at half strength,
// so one set type reads as a block however the cards are grouped. Purely a
// reading aid for this review — nothing about it is saved.
//
// PREVIEW MODE (`mode="preview"`): the calendar's admin-only "Preview Mode"
// opens this same workspace over the sets that ALREADY exist, so a whole
// season's rosters read and edit as one screen. Same layout, same cards, same
// load panel, same staged-until-you-commit rule — the differences are:
//   • the footer is Cancel / Save Changes, and Save hands the edited sets back
//     for the caller to diff and PATCH (lib/calendarPreview.previewSaves);
//   • a preview opens as an exact mirror of the calendar, so it only asks
//     before you leave once something has actually changed;
//   • "Already exists" on every card would be noise, so that badge and the
//     plan-wide Auto schedule / Clear all buttons sit this one out — a card's
//     own ⟳ is the fill affordance here, and there's no scheduler baseline
//     behind a real calendar for a whole-plan re-roll to balance against.
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Badge from "./common/Badge";
import LoadingDots from "./common/LoadingDots";
import ScrollRow from "./common/ScrollRow";
import PlayerSelect, { type PlayerOption } from "./PlayerSelect";
import { useOrgs } from "./OrgProvider";
import { orgHeaders } from "@/lib/api";
import { tintVars } from "@/lib/colors";
import Select from "./common/Select";
import {
  type Instrument,
} from "@/lib/constants";
import { formatDay, formatTime, startOfWeekMonday } from "@/lib/dates";
import {
  defaultMDId,
  eligibleMDIds,
  isValidMD,
  type MDAssignment,
} from "@/lib/md";
import { buildPlayerOptions } from "@/lib/playerOptions";
import { schedulableRolesByTeam } from "@/lib/roster";
import {
  buildSchedule,
  teamKey,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import {
  conflictedUserIds,
  countAssignments,
  isActiveForSet,
  loadRows,
  lockedCounts,
  designateMDs,
  maxLoad,
  previousMDForTeam,
  totalConflicts,
  totalLocked,
  totalUnfillable,
  unfillableRoles,
} from "@/lib/stagedPlan";
import {
  DEFAULT_PLAN_METRIC,
  type LoadMetric,
  metricLabel,
  metricToParam,
  parseLoadMetric,
  PLAN_LOAD_METRICS,
} from "@/lib/loadMetrics";
import {
  DEFAULT_TEAM_ROLES,
  slottedRoles,
  resolveTeamCapacities,
  teamSupportsMD,
  type TeamRoleDef,
} from "@/lib/teamRoles";
import { describePreviewSaves, previewSaves } from "@/lib/calendarPreview";
import type { ApiAdminUser, ApiTeam, StagedPlan, StagedSet } from "@/lib/types";

interface StagedScheduleModalProps {
  plan: StagedPlan | null; // null = closed
  users: ApiAdminUser[]; // for the reassignment dropdowns + name lookups
  // Every team in scope, each carrying its role catalog — a plan spans teams,
  // and each set's roster is drawn from ITS team's roles.
  teams: ApiTeam[];
  // Preview tints from the options dialog, keyed by the recurring set a card
  // came from. Empty (the default) = every card keeps the plain background.
  colors?: Record<string, string>;
  busy: boolean; // an apply is in flight
  // "generate" (the default) is the Create tab's reviewable proposal;
  // "preview" is the calendar's read-only lens over the real schedule.
  mode?: "generate" | "preview";
  // The org the Team load panel's windows are counted in. Defaults to the
  // admin tabs' org, which is the one the Create tab generates under.
  orgId?: string;
  // Commit: "Apply schedule" in the generate flow, "Save Changes" in a
  // preview (where the caller diffs the returned sets against what it opened
  // the preview with).
  onApply: (sets: StagedSet[]) => void;
  onClose: () => void; // discard the staged plan
}

/**
 * The week a set falls in, as a heading: "Week of Aug 24". Weeks run MON–SUN,
 * the way a week is planned: the midweek rehearsals group with the Sunday
 * service they lead up to, rather than that Sunday opening the next block.
 */
function weekLabel(startsAt: string): string {
  const monday = startOfWeekMonday(new Date(startsAt));
  return `Week of ${monday.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

/**
 * The editor's identity for a staged set. Normally its start time (one
 * occurrence per time in a generated plan); Preview Mode stages real calendar
 * sets, where two can share an instant, so those carry an explicit id.
 */
function stagingKey(set: StagedSet): string {
  return set.stagingId ?? set.startsAt;
}

export default function StagedScheduleModal({
  plan,
  users,
  teams,
  colors = {},
  busy,
  mode = "generate",
  orgId: orgIdProp,
  onApply,
  onClose,
}: StagedScheduleModalProps) {
  const preview = mode === "preview";
  // Which org's numbers the Team load panel asks for. The caller can name it
  // (Preview Mode follows the calendar's org); otherwise it's the admin tabs'
  // org, the one the Create tab generated this plan under.
  const { adminOrgId } = useOrgs();
  const orgId = orgIdProp ?? adminOrgId;
  // Editable copy of the proposal — reset whenever a fresh plan arrives.
  const [sets, setSets] = useState<StagedSet[]>([]);
  // Who the pointer is resting on, so every OTHER slot holding that person
  // lights up too. A plan is a wall of names across many cards, and the question
  // you keep asking is "where else is this person playing?" — this answers it
  // for a name you can see, and for a candidate you're considering in an open
  // dropdown, before you commit to them. Desktop-only: the styling is gated
  // behind `lg:` in PlayerSelect, since it needs a pointer and a screen wide
  // enough to show several sets at once.
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);
  // How the cards are grouped (see the header comment). Per-session, not
  // persisted — it's a reading preference for this one review.
  const [view, setView] = useState<"type" | "chrono">("type");
  // Guard on the way out: the plan only exists in this component, so closing
  // is the one action here that destroys work. Asked for both exits (Discard
  // and the ✕/backdrop), which is why it wraps onClose rather than sitting on
  // the button.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  useEffect(() => {
    setSets(plan?.sets ?? []);
    setConfirmDiscard(false);
  }, [plan]);

  const nameOf = useMemo(() => {
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return (id: string) => byId.get(id) ?? "Unknown";
  }, [users]);

  // The whole user row by id — the filled slots need their team memberships to
  // tell whether the person sitting there is inactive on this set's team.
  const userById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  const isMdOf = useMemo(() => {
    const mds = new Set(users.filter((u) => u.isMD).map((u) => u.id));
    return (id: string) => mds.has(id);
  }, [users]);

  // A staged roster in the shape lib/md.ts reads. A seat waiting on an admin's
  // approval (a taken cover, an accepted swap) still belongs to the person
  // handing it over, so the set's MD doesn't move before the handoff is real.
  const mdRoster = (list: StagedSet["assignments"]): MDAssignment[] =>
    list.map((x) => ({
      userId: x.userId,
      role: x.role,
      isMD: isMdOf(x.userId),
      pendingFrom: x.pendingFromUserId
        ? { userId: x.pendingFromUserId, isMD: isMdOf(x.pendingFromUserId) }
        : null,
    }));

  // Who led the nearest EARLIER set on the same team — the person this set's
  // auto-pick should pass over, so nobody directs two in a row. Mirrors the
  // chained pass in app/api/admin/generate so a re-run here reproduces what a
  // fresh server run would produce instead of drifting from it.
  //
  // Per team: two teams meeting the same week rotate independently. Falling
  // back to the plan's seed covers the first set of the run, whose predecessor
  // is a real set from before the window that the client never loaded.
  // Takes the sets ALREADY settled plus the team being decided — never an index
  // into a list that may not contain that set yet. See lib/stagedPlan.
  const previousMDFor = (
    earlier: StagedSet[],
    teamId: string | null | undefined
  ): string | null =>
    previousMDForTeam(earlier, teamId, plan?.baseline?.previousMDByTeam);

  // Every user's unavailability flattened into scheduler rules once, so both the
  // dropdowns and the conflict markers can tell who can't serve at a set's time.
  const rules = useMemo<UnavailabilityRule[]>(
    () =>
      users.flatMap((u) =>
        u.unavailability.map((r) => ({
          userId: u.id,
          type: r.type,
          dayOfWeek: r.dayOfWeek,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          startDate: r.startDate ? new Date(r.startDate) : null,
          endDate: r.endDate ? new Date(r.endDate) : null,
        }))
      ),
    [users]
  );

  // teamId → that team's role catalog, so each staged set is measured against
  // the roles its own team actually has.
  const catalogs = useMemo(
    () => new Map(teams.map((t) => [t.id, t.roles ?? DEFAULT_TEAM_ROLES])),
    [teams]
  );
  const catalogFor = (set: StagedSet): TeamRoleDef[] =>
    (set.teamId ? catalogs.get(set.teamId) : undefined) ?? DEFAULT_TEAM_ROLES;

  // The candidate pool both fills run over (the whole plan, and one card).
  // Inactive memberships are dropped, so neither can propose someone paused on
  // that team — the same rule the server's callers apply.
  const schedulerUsers = useMemo(
    () =>
      users.map((u) => ({
        id: u.id,
        isMD: u.isMD,
        rolesByTeam: schedulableRolesByTeam(
          u.teams.map((t) => ({
            teamId: t.id,
            roles: t.roles,
            active: t.active,
          }))
        ),
      })),
    [users]
  );

  // What the Team load panel measures people by: this plan (the default), or
  // the sets they're already on over some window. See LOAD_METRICS.
  const [metric, setMetric] = useState<LoadMetric>(DEFAULT_PLAN_METRIC);
  // Tallies fetched from the server, keyed by the metric that asked for them.
  // A window is only ever queried once per modal session — re-picking one you've
  // already looked at is instant, and the default view queries nothing at all.
  const [loadCache, setLoadCache] = useState<
    Record<string, Record<string, number>>
  >({});
  // Which window's fetch failed, if any — keyed by metric rather than a bare
  // boolean so a failure on one window doesn't mislabel the next one you pick.
  const [loadErrorKey, setLoadErrorKey] = useState<string | null>(null);

  // Fetch the selected window's tally, unless it's the plan (counted locally)
  // or we already have it. A wide window is a big read, which is exactly why
  // it's on demand instead of riding along with every generated plan.
  const metricKey = metricToParam(metric);
  useEffect(() => {
    if (!plan || metric === "plan" || loadCache[metricKey]) return;
    let cancelled = false;
    // Coming back to a window that failed before is a retry, not a failure.
    setLoadErrorKey((k) => (k === metricKey ? null : k));
    fetch(`/api/admin/team-load?metric=${encodeURIComponent(metricKey)}`, {
      headers: orgHeaders(orgId),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then((d) => {
        if (cancelled) return;
        setLoadCache((prev) => ({ ...prev, [metricKey]: d.counts ?? {} }));
      })
      .catch(() => !cancelled && setLoadErrorKey(metricKey));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, metric, metricKey, orgId]);

  // Load stats, recomputed on every edit — the "who's playing often" signal.
  // `counts` stays the PLAN's tally wherever the plan itself is the subject
  // (the ×N badge on a slot, the auto-schedule baseline); only the panel's bars
  // follow the selected metric.
  const counts = useMemo(() => countAssignments(sets), [sets]);
  // The fetched window as a Map. Absent while it's still loading, which is why
  // the panel keeps showing the plan's bars until the real numbers land.
  const windowCounts = loadCache[metricKey];
  const measuredBy = useMemo(
    () =>
      metric === "plan" || !windowCounts
        ? undefined
        : new Map(Object.entries(windowCounts)),
    [metric, windowCounts]
  );
  const loadError = loadErrorKey === metricKey;
  // The window has been asked for but hasn't landed yet — the panel holds its
  // shape and shows the dots rather than stale numbers under a new label.
  const loadPending = metric !== "plan" && !measuredBy && !loadError;
  const rows = useMemo(() => loadRows(sets, measuredBy), [sets, measuredBy]);
  const peak = useMemo(() => maxLoad(rows), [rows]);
  const conflicts = useMemo(() => totalConflicts(sets, rules), [sets, rules]);
  // Roles with an open slot nobody available can fill (structural holes).
  const unfillable = useMemo(
    () => totalUnfillable(sets, users, rules, catalogs),
    [sets, users, rules, catalogs]
  );

  if (!plan) return null;

  // Group the staged sets for the card layout — by set type, or by the day
  // they fall on. Either way sets are already in date order, so insertion
  // order gives chronological groups for free. Entries keep their index into
  // `sets` so the edit callbacks still address the master list.
  const groupedSets: [string, { set: StagedSet; idx: number }[]][] = [];
  {
    const groups = new Map<string, { set: StagedSet; idx: number }[]>();
    sets.forEach((set, idx) => {
      const key =
        view === "chrono" ? weekLabel(set.startsAt) : set.label ?? "Worship Set";
      const group = groups.get(key) ?? [];
      group.push({ set, idx });
      groups.set(key, group);
    });
    groupedSets.push(...groups.entries());
  }

  // What the Team load bars are measuring, spelled out under the panel. Built
  // here as a plain if-chain: three states nested as ternaries inside the JSX
  // was a lot to read for one line of text.
  const windowName = metricLabel(metric).toLowerCase();
  let loadNote: ReactNode = null;
  if (loadError) {
    loadNote = (
      <span className="text-red-600 dark:text-red-400">
        {" "}
        — couldn’t load {windowName}
      </span>
    );
  } else if (loadPending) {
    loadNote = ` — loading ${windowName}…`;
  } else if (metric !== "plan") {
    loadNote = ` — bars show ${windowName}`;
  }

  const totalAssignments = sets.reduce((n, s) => n + s.assignments.length, 0);
  // Hand-picked slots a re-run must keep — drives the 🔒 hint and the button's
  // tooltip.
  const lockedTotal = totalLocked(sets);
  // How many staged sets already exist (get filled) vs. are created fresh —
  // shown in the summary so it's clear nothing existing is recreated.
  const existingCount = sets.filter((s) => s.existing).length;
  const newCount = sets.length - existingCount;

  // ── Roster edits (all local until Apply) ──────────────────────────────
  const updateSet = (idx: number, next: (s: StagedSet) => StagedSet) =>
    setSets((prev) => prev.map((s, i) => (i === idx ? next(s) : s)));

  // Swap the person in a filled slot for someone else. A hand-picked slot is
  // LOCKED: a later "Auto schedule" run works around it instead of re-rolling
  // it (see autoScheduleAll).
  const reassign = (
    idx: number,
    oldUserId: string,
    role: Instrument,
    newUserId: string
  ) =>
    updateSet(idx, (s) => ({
      ...s,
      assignments: s.assignments.map((a) =>
        a.userId === oldUserId && a.role === role
          ? // Same SEAT, new person: `assignmentId` rides along so a preview
            // save updates the row (keeping its history) instead of deleting
            // and re-inserting it. Absent on a generated plan's seats.
            { assignmentId: a.assignmentId, userId: newUserId, role, locked: true }
          : a
      ),
    }));

  // Clearing a slot ("None") drops the assignment — and with it its lock, so
  // the next auto-schedule run is free to fill the slot again.
  const remove = (idx: number, userId: string, role: Instrument) =>
    updateSet(idx, (s) => ({
      ...s,
      assignments: s.assignments.filter(
        (a) => !(a.userId === userId && a.role === role)
      ),
    }));

  const add = (idx: number, role: Instrument, userId: string) =>
    updateSet(idx, (s) => ({
      ...s,
      assignments: [...s.assignments, { userId, role, locked: true }],
    }));

  // Release a lock without emptying the slot: the person stays for now, but the
  // next auto-schedule run may replace them. The other way out is "None".
  const unlock = (idx: number, userId: string, role: Instrument) =>
    updateSet(idx, (s) => ({
      ...s,
      assignments: s.assignments.map((a) =>
        a.userId === userId && a.role === role
          ? { assignmentId: a.assignmentId, userId, role }
          : a
      ),
    }));

  // Remove ONE slot of a role from ONE set (capacity − 1). For a filled slot
  // pass the person in it — they come out of the seat with it. Exactly the edit
  // SetDetailModal.deleteSlot makes, so the ✕ means the same thing in both
  // places; empty a role's last slot and the role stops being rendered here,
  // with the "+ role" chips below as the way back.
  //
  // A stale mdUserId needs no cleanup: `mdInfo` re-validates the pick against
  // the roster on every render, and applySets normalizes it before it ever
  // reaches the server.
  const deleteSlot = (idx: number, role: Instrument, userId?: string) =>
    updateSet(idx, (s) => {
      // Materialize the shape before editing it: a set with no override is
      // still following its team's defaults, and lowering one role has to pin
      // the rest rather than let them silently re-inherit later.
      const shape = resolveTeamCapacities(catalogFor(s), s.slotCapacities);
      return {
        ...s,
        slotCapacities: {
          ...shape,
          [role]: Math.max(0, (shape[role] ?? 0) - 1),
        },
        assignments: userId
          ? s.assignments.filter(
              (a) => !(a.userId === userId && a.role === role)
            )
          : s.assignments,
      };
    });

  // Put a removed role back, at the team's default count for it — the way back
  // from the ✕ above, since a zeroed role isn't rendered any more. The exact
  // count a template may have overridden is gone with the deletion; the team
  // default is the honest thing to restore, and the dropdowns take it from
  // there.
  const restoreRole = (idx: number, role: Instrument) =>
    updateSet(idx, (s) => {
      const catalog = catalogFor(s);
      const defaults = resolveTeamCapacities(catalog, null);
      return {
        ...s,
        slotCapacities: {
          ...resolveTeamCapacities(catalog, s.slotCapacities),
          [role]: Math.max(1, defaults[role] ?? 1),
        },
      };
    });

  // Empty every roster in one go: the plan keeps its sets, dates and shapes but
  // nobody on them — placeholder sets an admin fills in later. The MD goes with
  // them, since an MD has to be one of the assignees.
  const clearAllPeople = () =>
    setSets((prev) =>
      prev.map((s) => ({ ...s, assignments: [], mdUserId: null }))
    );

  // Re-run the fill over the CURRENT plan. This is the same pure function the
  // server ran (lib/scheduler.ts), fed the same starting tallies via
  // plan.baseline — so on a plan with no locks it reproduces the original
  // proposal exactly, which is what makes both "Clear all people" and a
  // re-run safe to click.
  //
  // Only LOCKED slots (the ones an admin hand-picked) survive a re-run: they
  // ride along as scheduler `preAssigned`, so their people are never moved,
  // never double-booked on that set, and their dates steer the spacing rule.
  // Everything the algorithm chose last time is dropped and re-proposed
  // around them.
  const autoScheduleAll = () => {
    // Locked slots per set, keyed by the staging id (the ISO start time).
    const keptBySet = new Map<string, StagedSet["assignments"]>(
      sets.map((s) => [stagingKey(s), s.assignments.filter((a) => a.locked)])
    );
    // The scheduler leaves pre-assigned people out of its GLOBAL load tally
    // (see the note on SchedulerSet.preAssigned), so fold the locked slots
    // into the baseline counts ourselves — otherwise someone pinned onto three
    // sets still looks unloaded and gets handed three more.
    const counts = new Map(Object.entries(plan?.baseline?.counts ?? {}));
    for (const [userId, n] of lockedCounts(sets)) {
      counts.set(userId, (counts.get(userId) ?? 0) + n);
    }

    const proposals = buildSchedule(
      sets.map((s) => ({
        // The staging identity, matching what the server keyed rosters by.
        id: stagingKey(s),
        startsAt: new Date(s.startsAt),
        durationMinutes: s.durationMinutes,
        roles: catalogFor(s),
        capacities: s.slotCapacities,
        requiresMD: s.requiresMD,
        teamId: s.teamId,
        preAssigned: (keptBySet.get(stagingKey(s)) ?? []).map((a) => ({
          userId: a.userId,
          role: a.role,
          isMD: isMdOf(a.userId),
        })),
      })),
      schedulerUsers,
      rules,
      counts,
      (plan?.baseline?.booked ?? []).map((b) => ({
        userId: b.userId,
        startsAt: new Date(b.startsAt),
      })),
      new Map(Object.entries(plan?.baseline?.teamCounts ?? {}))
    );

    const bySet = new Map<string, StagedSet["assignments"]>();
    for (const pr of proposals) {
      const roster = bySet.get(pr.setId) ?? [];
      roster.push({ userId: pr.userId, role: pr.role });
      bySet.set(pr.setId, roster);
    }

    setSets((prev) =>
      prev.map((s) => {
        // Locked picks first (they kept their slots), then the fresh proposals.
        const merged = [
          ...(keptBySet.get(stagingKey(s)) ?? []),
          ...(bySet.get(stagingKey(s)) ?? []),
        ];
        return { ...s, assignments: merged };
      })
    );
    // Re-derive MDs in a SECOND pass, in date order: each set's pick has to see
    // the one before it to avoid the same person leading twice running, which a
    // per-set map can't do. A kept pick that's still eligible survives.
    setSets((list) => redesignateMDs(list));
  };

  // Fill ONE card's empty slots and nothing else — the ⟳ button on a set.
  // Everyone already on the set (locked or not) rides along as `preAssigned`,
  // so the scheduler leaves them exactly where they are and only proposes
  // people for the holes.
  //
  // A whole-plan run sees every set at once and balances/spaces across them.
  // A single-set run can't, so it's handed the rest of the plan as context:
  // the other cards' seats fold into the load tallies and into the booked
  // dates, and one card's refill lands on the same person a full run would
  // have picked.
  const autoScheduleSet = (idx: number) => {
    const set = sets[idx];
    if (!set) return;

    // Load, per person and per team: the DB baseline plus every seat staged so
    // far. This set's own seats count too — they're pre-assigned, which the
    // scheduler deliberately leaves out of its own tally (see
    // SchedulerSet.preAssigned).
    const counts = new Map(Object.entries(plan?.baseline?.counts ?? {}));
    const teamCounts = new Map(
      Object.entries(plan?.baseline?.teamCounts ?? {})
    );
    for (const s of sets) {
      for (const a of s.assignments) {
        counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1);
        const key = teamKey(a.userId, s.teamId);
        teamCounts.set(key, (teamCounts.get(key) ?? 0) + 1);
      }
    }

    // Dates people are already booked on, for the 8-day spacing rule: the
    // baseline's real bookings plus the OTHER staged sets. This set is left
    // out — its own date is the one being filled.
    const booked = [
      ...(plan?.baseline?.booked ?? []).map((b) => ({
        userId: b.userId,
        startsAt: new Date(b.startsAt),
      })),
      ...sets.flatMap((s, i) =>
        i === idx
          ? []
          : s.assignments.map((a) => ({
              userId: a.userId,
              startsAt: new Date(s.startsAt),
            }))
      ),
    ];

    const proposals = buildSchedule(
      [
        {
          id: stagingKey(set),
          startsAt: new Date(set.startsAt),
          durationMinutes: set.durationMinutes,
          roles: catalogFor(set),
          capacities: set.slotCapacities,
          requiresMD: set.requiresMD,
          teamId: set.teamId,
          preAssigned: set.assignments.map((a) => ({
            userId: a.userId,
            role: a.role,
            isMD: isMdOf(a.userId),
          })),
        },
      ],
      schedulerUsers,
      rules,
      counts,
      booked,
      teamCounts
    );

    updateSet(idx, (s) => {
      const merged = [
        ...s.assignments,
        ...proposals.map((p) => ({ userId: p.userId, role: p.role })),
      ];
      const a = mdRoster(merged);
      return {
        ...s,
        assignments: merged,
        // Re-derive the MD the way a full run does: a still-eligible pick
        // survives, otherwise the best of the newly-complete roster — passing
        // over whoever led the set before this one on the same team.
        mdUserId: s.requiresMD
          ? isValidMD(s.mdUserId, a)
            ? s.mdUserId
            : defaultMDId(a, previousMDFor(sets.slice(0, idx), s.teamId))
          : null,
      };
    });
  };

  // Pick (or clear, with "") a staged set's designated MD.
  const setMD = (idx: number, userId: string) =>
    updateSet(idx, (s) => ({ ...s, mdUserId: userId || null }));

  // MD eligibility for a staged set, mirroring lib/md with our local isMD info:
  // eligible assignees, and the current pick if it's still valid.
  const mdInfo = (set: StagedSet) => {
    const a = mdRoster(set.assignments);
    return {
      eligibleIds: new Set(eligibleMDIds(a)),
      mdUserId: isValidMD(set.mdUserId, a) ? set.mdUserId : null,
    };
  };

  // Normalize each set's MD just before applying: keep a still-valid choice,
  // else auto-pick the best eligible one (mirrors the generate default). Sets
  // that don't require an MD carry none.
  const applySets = (): StagedSet[] => redesignateMDs(sets);

  // Walk an ordered run of sets and settle every MD, carrying the previous
  // pick forward per team. ONE place the rule lives, shared by the full re-run
  // and by apply, so what gets saved is what was previewed. A still-valid
  // existing pick is always kept — this only fills or replaces a stale one.
  const redesignateMDs = (list: StagedSet[]): StagedSet[] =>
    designateMDs(list, {
      isMD: isMdOf,
      seed: plan?.baseline?.previousMDByTeam,
    });

  // Options for a role's dropdown: users who play `role` and aren't already on
  // this set (one slot per set), each flagged available/unavailable at this
  // set's time plus inactive-on-this-team, and sorted available-and-active
  // first (mirrors SetDetailModal).
  const eligibleFor = (set: StagedSet, role: Instrument): PlayerOption[] =>
    buildPlayerOptions({
      users,
      role,
      teamId: set.teamId,
      set: {
        id: stagingKey(set),
        startsAt: new Date(set.startsAt),
        durationMinutes: set.durationMinutes,
      },
      rules,
      // One slot per person on a staged set, so anyone already on it is out.
      exclude: new Set(set.assignments.map((a) => a.userId)),
    });

  const title = preview ? "Schedule preview" : "Review generated schedule";
  // A preview opens as a mirror of the calendar, so until something is edited
  // there's nothing to save and nothing to lose. These are the pending edits:
  // one entry per set that actually differs from what the preview opened with.
  const pendingSaves = preview ? previewSaves(plan.sets, sets) : [];
  const dirty = pendingSaves.length > 0;
  // Leaving the generate flow always destroys a proposal that exists nowhere
  // else, so it asks first. A preview asks only once it has edits to lose.
  const requestClose = () =>
    preview && !dirty ? onClose() : setConfirmDiscard(true);

  // Nothing to review — everything in the window was already staffed.
  if (sets.length === 0) {
    return (
      <Modal open onClose={onClose} title={title}>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {preview ? "No sets to preview" : "Nothing to schedule in this window"}
          {plan.skipped > 0 &&
            ` — ${plan.skipped} set${
              plan.skipped === 1 ? "" : "s"
            } already staffed`}
          .
        </p>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <>
    <Modal
      open
      onClose={requestClose}
      title={title}
      size="full"
      // Pinned to the header, left of the ✕: it reframes the whole body, and
      // in a workspace this tall a control parked above the cards is scrolled
      // away the moment you start reading.
      headerActions={
        <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
          {(
            [
              ["type", "By set type"],
              ["chrono", "Chronological"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              aria-pressed={view === value}
              className={`whitespace-nowrap rounded-md font-medium transition-colors ${
                // Preview mode is the read-the-season view, where switching how
                // the calendar is laid out is the main thing you do here — so
                // its toggle is a size up.
                preview ? "px-3.5 py-1.5 text-sm" : "px-2.5 py-1 text-xs"
              } ${
                view === value
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      }
      footer={
        // Preview mode has nothing to commit, so its footer is the one way
        // out; the generate flow keeps Discard beside Apply.
        preview ? (
          // Same two-button shape as the generate flow: back out, or commit.
          // Save is dead until something has actually changed, so a preview
          // opened just to read can't write anything.
          <>
            <Button variant="secondary" onClick={requestClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => onApply(sets)}
              disabled={busy || !dirty}
              title={dirty ? undefined : "Nothing has been changed yet"}
            >
              {busy ? <LoadingDots size="sm" /> : "Save Changes"}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={requestClose}
              disabled={busy}
            >
              Discard
            </Button>
            <Button onClick={() => onApply(applySets())} disabled={busy}>
              {busy ? <LoadingDots size="sm" /> : "Apply schedule"}
            </Button>
          </>
        )
      }
    >
      {preview ? (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Showing <strong>{sets.length}</strong> upcoming set
          {sets.length === 1 ? "" : "s"} already on the calendar, with{" "}
          <strong>{totalAssignments}</strong> assignment
          {totalAssignments === 1 ? "" : "s"}. Move people around, or use a
          card&rsquo;s ⟳ to fill just its empty slots. Nothing reaches the
          calendar (and nobody is messaged) until you{" "}
          <strong>Save Changes</strong>.
        </p>
      ) : (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Staged <strong>{sets.length}</strong> set
          {sets.length === 1 ? "" : "s"} with{" "}
          <strong>{totalAssignments}</strong> assignment
          {totalAssignments === 1 ? "" : "s"}
          {existingCount > 0 &&
            ` (${newCount} new, ${existingCount} already exist${
              existingCount === 1 ? "s" : ""
            } and will be filled — not recreated)`}
          . Adjust anyone below, then apply — nothing is saved (or announced)
          until you do. Anyone you pick by hand is{" "}
          <span className="whitespace-nowrap">🔒 locked</span> and stays put if you
          re-run auto schedule; set their slot back to “None” (or click the 🔒) to
          release them.
          {plan.skipped > 0 &&
            ` ${plan.skipped} already-staffed set${
              plan.skipped === 1 ? "" : "s"
            } left untouched.`}
        </p>
      )}

      {/* Unfillable banner: a role has an open slot with no available person to
          fill it (nobody plays it, or all are busy). Look for the red roles. */}
      {unfillable > 0 && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          ⚠ {unfillable} role{unfillable === 1 ? "" : "s"} can’t be filled —
          nobody available. Look for the red roles marked “no one available”
          below.
        </p>
      )}

      {/* Conflict banner: a manual edit put someone on a set they're not free
          for. Non-blocking — surfaced so it's a deliberate choice. */}
      {conflicts > 0 && (
        <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          ⚠ {conflicts} assignment{conflicts === 1 ? "" : "s"} to someone who is
          unavailable at that time — look for the amber “unavailable” marks
          below.
        </p>
      )}

      {/* ── Team load: who's playing how often, full width ─────────────
          The selector switches what the bars MEASURE: this plan, or the sets
          each person is already on over a past/upcoming window. The people
          listed are always this plan's — it's their existing load the admin is
          weighing the plan against. */}
      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Team load
          </p>
          <div className="w-52">
            <Select
              label="Measure team load by"
              hideLabel
              className="!py-1.5 text-xs"
              value={metricKey}
              onChange={(e) => {
                // Option values are the metric in its wire form, so this is the
                // same parse the API route does (lib/loadMetrics.ts).
                const picked = parseLoadMetric(e.target.value);
                if (picked !== null) setMetric(picked);
              }}
            >
              {PLAN_LOAD_METRICS.map((m) => (
                <option key={metricToParam(m.metric)} value={metricToParam(m.metric)}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody assigned yet.</p>
        ) : (
          /* While a window loads, the list stays MOUNTED but hidden and the
             dots sit in the middle of the space it was already holding —
             `invisible` keeps its layout box, so picking a window doesn't
             collapse the panel and jerk everything below it up the page. */
          <div className="relative">
            <ul
              className={`grid max-h-40 grid-cols-1 gap-x-6 gap-y-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${
                loadPending ? "invisible" : ""
              }`}
              aria-busy={loadPending}
            >
              {rows.map((r) => (
                <LoadBar
                  key={r.userId}
                  name={nameOf(r.userId)}
                  count={r.count}
                  peak={peak}
                  isMD={isMdOf(r.userId)}
                />
              ))}
            </ul>
            {loadPending && (
              <div className="absolute inset-0 flex items-center justify-center">
                <LoadingDots label={`Loading ${metricLabel(metric).toLowerCase()}`} />
              </div>
            )}
          </div>
        )}
        <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {rows.length} {rows.length === 1 ? "person" : "people"} across{" "}
          {totalAssignments} slot{totalAssignments === 1 ? "" : "s"}
          {loadNote}
        </p>
      </div>

      {/* Plan-wide controls: re-run the fill, or empty the plan. They sit
          between the stats and the cards because that's what they act on — the
          load panel is what tells you whether to clear and start over.
          (The grouping toggle used to share this row; it lives in the modal
          header now, where scrolling can't take it away.)

          Preview mode has no proposal to re-roll: there's no scheduler
          baseline behind a real calendar, so a re-run would rebalance from
          zero and read as advice it isn't — and "Clear all people" would look
          like it emptied the real rosters. The whole row sits out there. */}
      {!preview && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={autoScheduleAll}
            disabled={busy}
            title={
              lockedTotal > 0
                ? `Re-run the scheduler — your ${lockedTotal} locked pick${
                    lockedTotal === 1 ? "" : "s"
                  } stay put, everyone else is re-proposed`
                : "Run the scheduler over every set again"
            }
          >
            {totalAssignments === 0 ? "Auto schedule all" : "Re-run auto schedule"}
          </Button>
          {totalAssignments > 0 && (
            <Button
              size="sm"
              variant="secondary"
              onClick={clearAllPeople}
              disabled={busy}
              // Placeholder sets: the dates and shapes are what's wanted now,
              // the people can come later. Nobody is notified about a set with
              // an empty roster, so applying these is silent.
              title="Empty every roster — the sets are still created, just with nobody on them"
            >
              Clear all people
            </Button>
          )}
          {lockedTotal > 0 && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              🔒 {lockedTotal} locked pick{lockedTotal === 1 ? "" : "s"} kept on
              a re-run
            </span>
          )}
        </div>
      )}

      {/* ── The cards. By set type: one sideways-scrolling row per label,
          reading a rotation across the weeks. Chronological: one section per
          day, days stacked down the page, each day's sets wrapping in a grid
          — so a Tuesday with a morning, noon and evening set reads together
          and the next day follows below. ─────────────────────────────────── */}
      <div className="mt-4 space-y-6">
        {groupedSets.map(([groupLabel, entries]) => (
          <section key={groupLabel}>
            {/* A tinted band, bled out past the modal body's px-6 so it runs
                edge to edge: with a dozen sideways-scrolling rows stacked up,
                a bare bold line wasn't enough to tell where one group of sets
                ended and the next began. Sticky, so the label of the group
                you're scrolled into stays overhead. */}
            <p
              className="sticky top-0 z-10 -mx-6 mb-2 border-y border-gray-200 bg-gray-100/95
                px-6 py-2 text-sm font-semibold backdrop-blur
                dark:border-gray-700 dark:bg-gray-900/95"
            >
              {groupLabel}
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                {entries.length} set{entries.length === 1 ? "" : "s"}
              </span>
            </p>
            {/* A row scrolls sideways through the weeks, and the fact that it
                DOES is easy to miss — macOS fades its scrollbar out the moment
                you stop. ScrollRow draws its own bar instead of relying on the
                native one, so the "there's more to the right" cue is always
                there (and draggable). */}
            <ScrollRow className="flex gap-3 pb-1">
              {entries.map(({ set, idx }) => {
            const catalog = catalogFor(set);
            const capacities = resolveTeamCapacities(catalog, set.slotCapacities);
            // The set's MD (only if still eligible) and who could take the role.
            const { eligibleIds: mdEligibleIds, mdUserId } = mdInfo(set);
            // A team without the MD role has no MD logic at all, so a leftover
            // requiresMD on one of its sets isn't something to flag.
            const supportsMD = teamSupportsMD(catalog);
            // Required-MD set with no eligible MD chosen → couldn't close it.
            const missingMD = supportsMD && set.requiresMD && !mdUserId;
            const conflicted = conflictedUserIds(set, rules);
            // How many slots are still empty on this card — the ⟳ button's
            // whole job, so it's what says whether there's anything to do.
            const openTotal = slottedRoles(catalog).reduce(
              (n, { key }) =>
                n +
                Math.max(
                  0,
                  capacities[key] -
                    set.assignments.filter((a) => a.role === key).length
                ),
              0
            );
            // Roles on this set no available person can fill — flagged in red.
            const cantFill = unfillableRoles(set, users, rules, catalog);
            // Roles the team offers that this set doesn't want (zero slots and
            // nobody in them) — exactly the ones the card hides below, offered
            // back as "+ role" chips.
            const removedRoles = slottedRoles(catalog).filter(
              ({ key }) =>
                capacities[key] === 0 &&
                !set.assignments.some((a) => a.role === key)
            );
            // This set type's tint, if the admin picked one — a fifth
            // strength in light mode, half that in dark, where the same alpha
            // over a near-black card shouts. Both go in as custom properties
            // so the CSS below picks one per theme (see lib/colors.ts).
            const tint = set.templateId
              ? tintVars(colors[set.templateId] ?? "", 0.2, 0.1)
              : null;
            return (
              <div
                key={stagingKey(set)}
                data-testid="staged-set-card"
                style={tint as CSSProperties | undefined}
                className={`flex w-72 shrink-0 flex-col rounded-lg border border-gray-200 p-3 dark:border-gray-700 ${
                  tint ? "bg-[var(--tint)] dark:bg-[var(--tint-dark)]" : ""
                }`}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {set.label ?? "Worship Set"}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-start gap-1.5">
                    <div className="flex flex-col items-end gap-1">
                      {/* Whether Apply creates this set or fills one that
                          already exists (same name + time) — existing ones are
                          never recreated, only filled. Every card in a preview
                          is an existing set, so the badge says nothing there. */}
                      {!preview && (
                        <Badge tone={set.existing ? "amber" : "green"}>
                          {set.existing ? "Already exists" : "New set"}
                        </Badge>
                      )}
                      {supportsMD && set.requiresMD && (
                        <Badge tone={missingMD ? "amber" : "blue"}>
                          {missingMD ? "⚠ No MD" : "MD ✓"}
                        </Badge>
                      )}
                    </div>
                    {/* Fill just this card's holes. Pinned to the card's top
                        right corner (after the badges) so it's in the same
                        place on every card, badges or not. */}
                    <FillSetButton
                      openSlots={openTotal}
                      disabled={busy}
                      onClick={() => autoScheduleSet(idx)}
                    />
                  </div>
                </div>

                {missingMD && (
                  <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                    Requires an MD but none could be scheduled. Assign one below
                    or apply as-is and fix it later.
                  </p>
                )}

                <ul className="space-y-2">
                  {slottedRoles(catalog).map(({ key: role, label: roleName }) => {
                    const capacity = capacities[role];
                    const filled = set.assignments.filter(
                      (a) => a.role === role
                    );
                    const openSlots = Math.max(0, capacity - filled.length);
                    const options = eligibleFor(set, role);

                    // Hide roles this set doesn't want and nobody's in.
                    if (capacity === 0 && filled.length === 0) return null;

                    const noneAvailable = cantFill.has(role);
                    return (
                      <li key={role}>
                        <span
                          className={`text-xs font-medium ${
                            noneAvailable
                              ? "text-red-600 dark:text-red-400"
                              : "text-gray-600 dark:text-gray-400"
                          }`}
                        >
                          {roleName}
                          {capacity > 1 && (
                            <span className="ml-1 text-gray-400">
                              ({filled.length}/{capacity})
                            </span>
                          )}
                          {noneAvailable && (
                            <span className="ml-1 font-semibold">
                              · no one available
                            </span>
                          )}
                        </span>
                        <div className="mt-1 space-y-1">
                          {/* Filled slots: swap or clear via the dropdown. */}
                          {filled.map((a) => (
                            <div
                              key={`${a.userId}-${role}`}
                              className="flex items-center gap-1.5"
                            >
                              {/* Leftmost, the way SetDetailModal's slot ✕ is:
                                  removes this slot and takes the person in it
                                  out with it. */}
                              <SlotDeleteButton
                                disabled={busy}
                                label={`Remove ${roleName} slot (${nameOf(
                                  a.userId
                                )})`}
                                onClick={() => deleteSlot(idx, role, a.userId)}
                              />
                              <LockCell
                                locked={!!a.locked}
                                onUnlock={() => unlock(idx, a.userId, role)}
                              />
                              <PlayerSelect
                                selected={{
                                  id: a.userId,
                                  name: nameOf(a.userId),
                                  // Same flags the open list puts on everyone
                                  // else, so the person already in the slot
                                  // isn't the one name without them.
                                  available: !conflicted.has(a.userId),
                                  inactive: !isActiveForSet(
                                    userById.get(a.userId) ?? { id: a.userId },
                                    set.teamId
                                  ),
                                  // The designated MD rides inside the box with
                                  // the name, so the box still ends where every
                                  // other box on the card ends.
                                  tag:
                                    a.userId === mdUserId ? "* (MD)" : undefined,
                                }}
                                options={options}
                                disabled={busy}
                                // Locked = you chose this person; the box is
                                // tinted so a hand-picked roster reads apart
                                // from the auto-filled one at a glance.
                                locked={a.locked}
                                highlighted={hoveredUserId === a.userId}
                                // The control reports WHO is under the pointer
                                // — its own occupant while closed, or whichever
                                // option row you're on once it's open — so this
                                // just follows it. Safe as a direct set: the DOM
                                // fires the old element's mouseleave before the
                                // new one's mouseenter, so a clear can't land on
                                // top of a highlight that just started.
                                onHoverChange={setHoveredUserId}
                                widthClass="w-full min-w-0 flex-1"
                                onChange={(userId) =>
                                  userId
                                    ? reassign(idx, a.userId, role, userId)
                                    : remove(idx, a.userId, role)
                                }
                              />
                              <LoadCell count={counts.get(a.userId) ?? 0} />
                            </div>
                          ))}

                          {/* Empty slots: pick someone to fill them. */}
                          {Array.from({ length: openSlots }).map((_, i) => (
                            /* The same columns as a filled row — an empty lock
                               cell and an empty load cell — so an unfilled
                               slot's box starts and ends exactly where the
                               filled ones above it do. */
                            <div
                              key={`add-${role}-${i}`}
                              className="flex items-center gap-1.5"
                            >
                              {/* Nobody to take with it, so no confirm needed
                                  either — it just drops the empty slot. */}
                              <SlotDeleteButton
                                disabled={busy}
                                label={`Remove empty ${roleName} slot`}
                                onClick={() => deleteSlot(idx, role)}
                              />
                              <LockCell locked={false} />
                              <PlayerSelect
                                selected={null}
                                options={options}
                                disabled={busy}
                                dashed
                                widthClass="w-full min-w-0 flex-1"
                                onChange={(userId) =>
                                  userId && add(idx, role, userId)
                                }
                              />
                              <LoadCell />
                            </div>
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {/* The way back from a ✕ — and the only way to add a role the
                    template never wanted. Listed only when there IS one to add,
                    so an untouched card carries nothing extra. */}
                {removedRoles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {removedRoles.map(({ key, label }) => (
                      <button
                        key={key}
                        type="button"
                        disabled={busy}
                        onClick={() => restoreRole(idx, key)}
                        title={`Add ${label} back to this set`}
                        className="rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-[10px]
                          leading-4 text-gray-500 hover:border-indigo-400 hover:text-indigo-600
                          disabled:opacity-50 dark:border-gray-600 dark:text-gray-400
                          dark:hover:border-indigo-500 dark:hover:text-indigo-400"
                      >
                        + {label}
                      </button>
                    ))}
                  </div>
                )}

                {/* MD picker: one per set, chosen from the assignees; only those
                    who qualify (an MD on keys/electric/bass, not the WL) are
                    clickable. Empty when nobody qualifies. Absent entirely for
                    a team whose catalog has no MD role. */}
                {supportsMD && set.requiresMD && (
                  <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
                    {mdEligibleIds.size === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        No eligible MD — needs someone on keys, electric guitar,
                        or bass.
                      </p>
                    ) : (
                      <Select
                        label="MD"
                        value={mdUserId ?? ""}
                        disabled={busy}
                        onChange={(e) => setMD(idx, e.target.value)}
                        className="py-1 text-xs"
                      >
                        <option value="">None</option>
                        {Array.from(
                          new Set(set.assignments.map((a) => a.userId))
                        ).map((uid) => (
                          <option
                            key={uid}
                            value={uid}
                            disabled={!mdEligibleIds.has(uid)}
                          >
                            {nameOf(uid)}
                            {mdEligibleIds.has(uid) ? "" : " — not eligible"}
                          </option>
                        ))}
                      </Select>
                    )}
                  </div>
                )}
              </div>
              );
              })}
            </ScrollRow>
          </section>
        ))}
      </div>
    </Modal>

    {/* Nothing here has touched the database, so leaving loses the whole
        proposal — worth one question rather than one stray click. A sibling
        of the review modal, so the two overlays stack cleanly. Escape hits
        both listeners: this one wins (registered last), so Escape backs out
        of the confirmation rather than out of the review. */}
    <Modal
      open={confirmDiscard}
      onClose={() => setConfirmDiscard(false)}
      title={preview ? "Discard your changes?" : "Discard this preview?"}
      footer={
        <>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
            Keep {preview ? "editing" : "reviewing"}
          </Button>
          <Button variant="danger" onClick={onClose}>
            Discard
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">
        {preview ? (
          <>
            You have {describePreviewSaves(pendingSaves)} that haven&rsquo;t
            been saved. Leaving now throws them away and the calendar stays
            exactly as it is.
          </>
        ) : (
          <>
            This preview was never saved — {sets.length} staged set
            {sets.length === 1 ? "" : "s"} and any changes you&rsquo;ve made
            here will be lost, and you&rsquo;ll need to auto schedule again to
            get them back. Nothing on the calendar changes either way.
          </>
        )}
      </p>
    </Modal>
    </>
  );
}

// One row of the Team load panel: name, a bar scaled to the busiest person, and
// ONE number — how many slots that person holds in whatever window the picker
// is showing. The busiest people get an amber bar so over-use is easy to spot.
function LoadBar({
  name,
  count,
  peak,
  isMD,
}: {
  name: string;
  count: number;
  peak: number;
  isMD: boolean;
}) {
  const pct = peak > 0 ? Math.round((count / peak) * 100) : 0;
  // Flag the heaviest tier (≥80% of the peak, and more than one set) so a long
  // list still reads at a glance.
  const heavy = peak > 1 && count >= peak * 0.8;
  return (
    <li className="text-sm">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-gray-800 dark:text-gray-100">
          {name}
          {isMD && (
            <span className="ml-1 text-xs font-medium text-indigo-600 dark:text-indigo-400">
              MD
            </span>
          )}
        </span>
        <span
          className={`shrink-0 text-xs font-semibold tabular-nums ${
            heavy
              ? "text-amber-600 dark:text-amber-400"
              : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {count}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
        <div
          className={`h-full rounded-full ${
            heavy ? "bg-amber-500" : "bg-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </li>
  );
}

// The ⟳ button in a card's top-right corner: auto-schedule this ONE set's
// empty slots, leaving everyone already on it exactly where they are. Greyed
// out (and saying so) when the roster is already full, so the button always
// tells you whether there's a hole to fill.
function FillSetButton({
  openSlots,
  disabled,
  onClick,
}: {
  openSlots: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const full = openSlots === 0;
  const label = full
    ? "Every slot on this set is filled"
    : `Auto schedule this set's ${openSlots} empty slot${
        openSlots === 1 ? "" : "s"
      } — nobody already on it moves`;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || full}
      title={label}
      aria-label={label}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400
        transition-colors hover:bg-indigo-50 hover:text-indigo-600
        disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent
        disabled:hover:text-gray-400 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-400"
    >
      <RefreshIcon />
    </button>
  );
}

// Two arrows chasing each other round a circle — the usual "refill this"
// glyph. Drawn rather than pulled in, like every other icon in the app.
function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M16.5 8.5A6.5 6.5 0 004.9 5.6M3.5 11.5a6.5 6.5 0 0011.6 2.9"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      {/* The arrowheads: one at the top-left of the upper arc, one at the
          bottom-right of the lower, so the pair reads as a loop. */}
      <path
        d="M4.5 2.5v3.2h3.2M15.5 17.5v-3.2h-3.2"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The 🔒 column to the LEFT of a slot's dropdown: shown when you picked this
// person yourself (auto schedule will then keep them), and clicking it hands
// the slot back to the scheduler without emptying it. It keeps its width when
// there's no lock to draw, so every dropdown on a card starts at the same edge.
function LockCell({
  locked,
  onUnlock,
}: {
  locked: boolean;
  // Absent on an empty slot — there's nothing to unlock, the cell is a spacer.
  onUnlock?: () => void;
}) {
  return (
    <span className="flex w-4 shrink-0 justify-center text-xs">
      {locked && (
        <button
          type="button"
          onClick={onUnlock}
          aria-label="Unlock this slot"
          title="You picked this person — auto schedule will keep them. Click to unlock."
          className="leading-none text-indigo-600 hover:opacity-70 dark:text-indigo-400"
        >
          🔒
        </button>
      )}
    </span>
  );
}

// The load column to the RIGHT: how many sets this person is on in the plan.
// Fixed at the width of a two-digit count and right-aligned, and drawn (empty)
// for unfilled slots too — the point is that every dropdown in the column ends
// at the same edge, not that the number is snug.
// The ✕ at the head of a slot row: drops that slot from this one set. Same
// look, hit area and position (leftmost) as SetDetailModal's slot ✕, so the
// gesture reads the same in both places.
function SlotDeleteButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0 rounded p-0.5 text-xs leading-none text-gray-400
        hover:bg-red-50 hover:text-red-600 disabled:opacity-50
        dark:hover:bg-red-900/30 dark:hover:text-red-400"
    >
      ✕
    </button>
  );
}

function LoadCell({ count }: { count?: number }) {
  return (
    <span
      className="w-7 shrink-0 text-right text-xs tabular-nums text-gray-400"
      title={
        count === undefined
          ? undefined
          : `On ${count} set${count === 1 ? "" : "s"} this run`
      }
    >
      {count === undefined ? "" : `×${count}`}
    </span>
  );
}
