"use client";
// Review step for the Create tab's "Generate" flow. The scheduler proposes a
// plan (POST /api/admin/generate, a dry run); this modal lets the admin move
// people around before committing. Every edit here is LOCAL state — nothing
// is saved (and no emails/Slack fire) until "Apply schedule" posts the final
// plan to /api/admin/generate/apply.
//
// Layout: a near-full-screen workspace. A "Team load" panel across the top
// shows who is playing how often (so the admin can spot over/under-used
// people at a glance); below it, the occurrence cards, grouped either way:
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
import { useEffect, useMemo, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Badge from "./common/Badge";
import LoadingDots from "./common/LoadingDots";
import PlayerSelect, { type PlayerOption } from "./PlayerSelect";
import Select from "./common/Select";
import {
  INSTRUMENT_LABELS,
  type Instrument,
} from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import { defaultMDId, eligibleMDIds, isValidMD } from "@/lib/md";
import { buildPlayerOptions } from "@/lib/playerOptions";
import { schedulableRolesByTeam } from "@/lib/roster";
import {
  buildSchedule,
  isUserAvailable,
  type UnavailabilityRule,
} from "@/lib/scheduler";
import {
  conflictedUserIds,
  countAssignments,
  loadRows,
  maxLoad,
  playsRoleForSet,
  totalConflicts,
  totalUnfillable,
  unfillableRoles,
} from "@/lib/stagedPlan";
import {
  DEFAULT_TEAM_ROLES,
  bandRoles,
  resolveTeamCapacities,
  teamSupportsMD,
  type TeamRoleDef,
} from "@/lib/teamRoles";
import type { ApiAdminUser, ApiTeam, StagedPlan, StagedSet } from "@/lib/types";

interface StagedScheduleModalProps {
  plan: StagedPlan | null; // null = closed
  users: ApiAdminUser[]; // for the reassignment dropdowns + name lookups
  // Every team in scope, each carrying its role catalog — a plan spans teams,
  // and each set's roster is drawn from ITS team's roles.
  teams: ApiTeam[];
  busy: boolean; // an apply is in flight
  onApply: (sets: StagedSet[]) => void;
  onClose: () => void; // discard the staged plan
}

/**
 * The week a set falls in, as a heading: "Week of Aug 24". Weeks run Sun–Sat,
 * matching the calendar grid, so a Sunday service and the Thursday rehearsal
 * after it group together the way a paper schedule would.
 */
function weekLabel(startsAt: string): string {
  const d = new Date(startsAt);
  const sunday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay());
  return `Week of ${sunday.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

export default function StagedScheduleModal({
  plan,
  users,
  teams,
  busy,
  onApply,
  onClose,
}: StagedScheduleModalProps) {
  // Editable copy of the proposal — reset whenever a fresh plan arrives.
  const [sets, setSets] = useState<StagedSet[]>([]);
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

  const isMdOf = useMemo(() => {
    const mds = new Set(users.filter((u) => u.isMD).map((u) => u.id));
    return (id: string) => mds.has(id);
  }, [users]);

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

  // Load stats, recomputed on every edit — the "who's playing often" signal.
  const counts = useMemo(() => countAssignments(sets), [sets]);
  const rows = useMemo(() => loadRows(sets), [sets]);
  const peak = useMemo(() => maxLoad(sets), [sets]);
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

  const totalAssignments = sets.reduce((n, s) => n + s.assignments.length, 0);
  // How many staged sets already exist (get filled) vs. are created fresh —
  // shown in the summary so it's clear nothing existing is recreated.
  const existingCount = sets.filter((s) => s.existing).length;
  const newCount = sets.length - existingCount;

  // ── Roster edits (all local until Apply) ──────────────────────────────
  const updateSet = (idx: number, next: (s: StagedSet) => StagedSet) =>
    setSets((prev) => prev.map((s, i) => (i === idx ? next(s) : s)));

  // Swap the person in a filled slot for someone else.
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
          ? { userId: newUserId, role }
          : a
      ),
    }));

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
      assignments: [...s.assignments, { userId, role }],
    }));

  // Empty every roster in one go: the plan keeps its sets, dates and shapes but
  // nobody on them — placeholder sets an admin fills in later. The MD goes with
  // them, since an MD has to be one of the assignees.
  const clearAllPeople = () =>
    setSets((prev) =>
      prev.map((s) => ({ ...s, assignments: [], mdUserId: null }))
    );

  // Re-run the fill over the CURRENT plan. This is the same pure function the
  // server ran (lib/scheduler.ts), fed the same starting tallies via
  // plan.baseline — so on an emptied plan it reproduces the original proposal
  // exactly, which is what makes "Clear all people" safe to click. Anyone
  // still on a set rides along as `preAssigned`: hand-picks are kept and only
  // the holes get filled.
  const autoScheduleAll = () => {
    const proposals = buildSchedule(
      sets.map((s) => ({
        // The staging identity, matching what the server keyed rosters by.
        id: s.startsAt,
        startsAt: new Date(s.startsAt),
        durationMinutes: s.durationMinutes,
        roles: catalogFor(s),
        capacities: s.slotCapacities,
        requiresMD: s.requiresMD,
        teamId: s.teamId,
        preAssigned: s.assignments.map((a) => ({
          userId: a.userId,
          role: a.role,
          isMD: isMdOf(a.userId),
        })),
      })),
      users.map((u) => ({
        id: u.id,
        isMD: u.isMD,
        // Inactive memberships are dropped, so the fill can't propose someone
        // paused on that team — the same rule the server's callers apply.
        rolesByTeam: schedulableRolesByTeam(
          u.teams.map((t) => ({
            teamId: t.id,
            roles: t.roles,
            active: t.active,
          }))
        ),
      })),
      rules,
      new Map(Object.entries(plan?.baseline?.counts ?? {})),
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
        const merged = [...s.assignments, ...(bySet.get(s.startsAt) ?? [])];
        return {
          ...s,
          assignments: merged,
          // Re-derive the MD the way the server does — a kept pick that's
          // still eligible survives, otherwise the best of the new roster.
          mdUserId: s.requiresMD
            ? (() => {
                const a = merged.map((x) => ({
                  userId: x.userId,
                  role: x.role,
                  isMD: isMdOf(x.userId),
                }));
                return isValidMD(s.mdUserId, a) ? s.mdUserId : defaultMDId(a);
              })()
            : null,
        };
      })
    );
  };

  // Pick (or clear, with "") a staged set's designated MD.
  const setMD = (idx: number, userId: string) =>
    updateSet(idx, (s) => ({ ...s, mdUserId: userId || null }));

  // MD eligibility for a staged set, mirroring lib/md with our local isMD info:
  // eligible assignees, and the current pick if it's still valid.
  const mdInfo = (set: StagedSet) => {
    const a = set.assignments.map((x) => ({
      userId: x.userId,
      role: x.role,
      isMD: isMdOf(x.userId),
    }));
    return {
      eligibleIds: new Set(eligibleMDIds(a)),
      mdUserId: isValidMD(set.mdUserId, a) ? set.mdUserId : null,
    };
  };

  // Normalize each set's MD just before applying: keep a still-valid choice,
  // else auto-pick the best eligible one (mirrors the generate default). Sets
  // that don't require an MD carry none.
  const applySets = (): StagedSet[] =>
    sets.map((s) => {
      if (!s.requiresMD) return { ...s, mdUserId: null };
      const a = s.assignments.map((x) => ({
        userId: x.userId,
        role: x.role,
        isMD: isMdOf(x.userId),
      }));
      return {
        ...s,
        mdUserId: isValidMD(s.mdUserId, a) ? s.mdUserId : defaultMDId(a),
      };
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
        id: set.startsAt,
        startsAt: new Date(set.startsAt),
        durationMinutes: set.durationMinutes,
      },
      rules,
      // One slot per person on a staged set, so anyone already on it is out.
      exclude: new Set(set.assignments.map((a) => a.userId)),
    });

  // Nothing to review — everything in the window was already staffed.
  if (sets.length === 0) {
    return (
      <Modal open onClose={onClose} title="Review generated schedule">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Nothing to schedule in this window
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
      onClose={() => setConfirmDiscard(true)}
      title="Review generated schedule"
      size="full"
      footer={
        <>
          <Button
            variant="secondary"
            onClick={() => setConfirmDiscard(true)}
            disabled={busy}
          >
            Discard
          </Button>
          <Button onClick={() => onApply(applySets())} disabled={busy}>
            {busy ? <LoadingDots size="sm" /> : "Apply schedule"}
          </Button>
        </>
      }
    >
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
        until you do.
        {plan.skipped > 0 &&
          ` ${plan.skipped} already-staffed set${
            plan.skipped === 1 ? "" : "s"
          } left untouched.`}
      </p>

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

      {/* ── Team load: who's playing how often, full width ───────────── */}
      <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Team load
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-400">Nobody assigned yet.</p>
        ) : (
          <ul className="grid max-h-40 grid-cols-1 gap-x-6 gap-y-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
        )}
        <p className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          {rows.length} {rows.length === 1 ? "person" : "people"} across{" "}
          {totalAssignments} slot{totalAssignments === 1 ? "" : "s"}
        </p>
      </div>

      {/* Plan-wide controls: how to read the cards, and the one-click empty.
          They sit between the stats and the cards because that's what they act
          on — the load panel is what tells you whether to clear and start over. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {/* One toggle: empty the plan, or fill it back up. An emptied plan
            refills to exactly what the server proposed (same algorithm, same
            baseline), so clearing is never a one-way door. */}
        {totalAssignments === 0 ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={autoScheduleAll}
            disabled={busy}
            title="Run the scheduler over every set again"
          >
            Auto schedule all
          </Button>
        ) : (
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
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                view === value
                  ? "bg-indigo-600 text-white"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── The cards. By set type: one sideways-scrolling row per label,
          reading a rotation across the weeks. Chronological: one section per
          day, days stacked down the page, each day's sets wrapping in a grid
          — so a Tuesday with a morning, noon and evening set reads together
          and the next day follows below. ─────────────────────────────────── */}
      <div className="mt-4 space-y-5">
        {groupedSets.map(([groupLabel, entries]) => (
          <section key={groupLabel}>
            <p className="mb-2 text-sm font-semibold">
              {groupLabel}
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                {entries.length} set{entries.length === 1 ? "" : "s"}
              </span>
            </p>
            <div className="flex gap-3 overflow-x-auto pb-2">
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
            // Roles on this set no available person can fill — flagged in red.
            const cantFill = unfillableRoles(set, users, rules, catalog);
            return (
              <div
                key={set.startsAt}
                data-testid="staged-set-card"
                className="flex w-72 shrink-0 flex-col rounded-lg border border-gray-200 p-3 dark:border-gray-700"
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
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {/* Whether Apply creates this set or fills one that already
                        exists (same name + time) — existing ones are never
                        recreated, only filled. */}
                    <Badge tone={set.existing ? "amber" : "green"}>
                      {set.existing ? "Already exists" : "New set"}
                    </Badge>
                    {supportsMD && set.requiresMD && (
                      <Badge tone={missingMD ? "amber" : "blue"}>
                        {missingMD ? "⚠ No MD" : "MD ✓"}
                      </Badge>
                    )}
                  </div>
                </div>

                {missingMD && (
                  <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                    Requires an MD but none could be scheduled. Assign one below
                    or apply as-is and fix it later.
                  </p>
                )}

                <ul className="space-y-2">
                  {bandRoles(catalog).map(({ key: role, label: roleName }) => {
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
                              <PlayerSelect
                                selected={{
                                  id: a.userId,
                                  name: nameOf(a.userId),
                                }}
                                options={options}
                                disabled={busy}
                                widthClass="w-full min-w-0 flex-1"
                                onChange={(userId) =>
                                  userId
                                    ? reassign(idx, a.userId, role, userId)
                                    : remove(idx, a.userId, role)
                                }
                              />
                              <SlotMarkers
                                count={counts.get(a.userId) ?? 0}
                                isMD={a.userId === mdUserId}
                                unavailable={conflicted.has(a.userId)}
                              />
                            </div>
                          ))}

                          {/* Empty slots: pick someone to fill them. */}
                          {Array.from({ length: openSlots }).map((_, i) => (
                            <PlayerSelect
                              key={`add-${role}-${i}`}
                              selected={null}
                              options={options}
                              disabled={busy}
                              dashed
                              widthClass="w-full"
                              onChange={(userId) =>
                                userId && add(idx, role, userId)
                              }
                            />
                          ))}
                        </div>
                      </li>
                    );
                  })}
                </ul>

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
            </div>
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
      title="Discard this preview?"
      footer={
        <>
          <Button variant="secondary" onClick={() => setConfirmDiscard(false)}>
            Keep reviewing
          </Button>
          <Button variant="danger" onClick={onClose}>
            Discard
          </Button>
        </>
      }
    >
      <p className="text-sm text-gray-600 dark:text-gray-400">
        This preview was never saved — {sets.length} staged set
        {sets.length === 1 ? "" : "s"} and any changes you&rsquo;ve made here
        will be lost, and you&rsquo;ll need to auto schedule again to get them
        back. Nothing on the calendar changes either way.
      </p>
    </Modal>
    </>
  );
}

// One row of the Team load panel: name, a bar scaled to the busiest person, and
// the count. The busiest people get an amber bar so over-use is easy to spot.
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

// The little badges to the right of a filled slot: total load (×N), an MD tag,
// and an "unavailable" warning when the person can't serve at this set's time.
function SlotMarkers({
  count,
  isMD,
  unavailable,
}: {
  count: number;
  isMD: boolean;
  unavailable: boolean;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs">
      {unavailable && (
        <span
          className="font-medium text-amber-600 dark:text-amber-400"
          title="Unavailable at this set's time"
        >
          unavailable
        </span>
      )}
      {isMD && (
        <span className="font-medium text-indigo-600 dark:text-indigo-400">
          * (MD)
        </span>
      )}
      <span
        className="tabular-nums text-gray-400"
        title={`On ${count} set${count === 1 ? "" : "s"} this run`}
      >
        ×{count}
      </span>
    </span>
  );
}
