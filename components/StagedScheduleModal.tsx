"use client";
// Review step for the Create tab's "Generate" flow. The scheduler proposes a
// plan (POST /api/admin/generate, a dry run); this modal lets the admin move
// people around before committing. Every edit here is LOCAL state — nothing
// is saved (and no emails/Slack fire) until "Apply schedule" posts the final
// plan to /api/admin/generate/apply.
//
// Layout: a near-full-screen workspace. A "Team load" panel across the top
// shows who is playing how often (so the admin can spot over/under-used
// people at a glance); below it, each recurring set type (grouped by label)
// gets its own horizontally-scrolling row of occurrence cards. Every roster
// dropdown is availability-aware — people who can't serve at a set's time are
// flagged and sorted last (same PlayerSelect the calendar's SetDetailModal
// uses).
import { useEffect, useMemo, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Badge from "./common/Badge";
import LoadingDots from "./common/LoadingDots";
import PlayerSelect, { type PlayerOption } from "./PlayerSelect";
import {
  INSTRUMENT_LABELS,
  MD_ROLES,
  ROLE_ORDER,
  resolveCapacities,
  type Instrument,
} from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import { isUserAvailable, type UnavailabilityRule } from "@/lib/scheduler";
import {
  conflictedUserIds,
  countAssignments,
  isOnTeam,
  loadRows,
  maxLoad,
  totalConflicts,
  totalUnfillable,
  unfillableRoles,
} from "@/lib/stagedPlan";
import type { ApiAdminUser, StagedPlan, StagedSet } from "@/lib/types";

interface StagedScheduleModalProps {
  plan: StagedPlan | null; // null = closed
  users: ApiAdminUser[]; // for the reassignment dropdowns + name lookups
  busy: boolean; // an apply is in flight
  onApply: (sets: StagedSet[]) => void;
  onClose: () => void; // discard the staged plan
}

export default function StagedScheduleModal({
  plan,
  users,
  busy,
  onApply,
  onClose,
}: StagedScheduleModalProps) {
  // Editable copy of the proposal — reset whenever a fresh plan arrives.
  const [sets, setSets] = useState<StagedSet[]>([]);
  useEffect(() => {
    setSets(plan?.sets ?? []);
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

  // Load stats, recomputed on every edit — the "who's playing often" signal.
  const counts = useMemo(() => countAssignments(sets), [sets]);
  const rows = useMemo(() => loadRows(sets), [sets]);
  const peak = useMemo(() => maxLoad(sets), [sets]);
  const conflicts = useMemo(() => totalConflicts(sets, rules), [sets, rules]);
  // Roles with an open slot nobody available can fill (structural holes).
  const unfillable = useMemo(
    () => totalUnfillable(sets, users, rules),
    [sets, users, rules]
  );

  if (!plan) return null;

  // Group the staged sets by label ("recurring set type") for the row layout:
  // each label gets one horizontally-scrolling row of its occurrences, in date
  // order (sets are already sorted). Entries keep their index into `sets` so
  // the edit callbacks still address the master list.
  const groupedSets: [string, { set: StagedSet; idx: number }[]][] = [];
  {
    const byLabel = new Map<string, { set: StagedSet; idx: number }[]>();
    sets.forEach((set, idx) => {
      const label = set.label ?? "Worship Set";
      const group = byLabel.get(label) ?? [];
      group.push({ set, idx });
      byLabel.set(label, group);
    });
    groupedSets.push(...byLabel.entries());
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

  // Options for a role's dropdown: users who play `role` and aren't already on
  // this set (one slot per set), each flagged available/unavailable at this
  // set's time and sorted available-first (mirrors SetDetailModal).
  const eligibleFor = (set: StagedSet, role: Instrument): PlayerOption[] => {
    const onSet = new Set(set.assignments.map((a) => a.userId));
    const calcSet = {
      id: set.startsAt,
      startsAt: new Date(set.startsAt),
      durationMinutes: set.durationMinutes,
    };
    return users
      // Only the set's team members are offered (no team = open to everyone).
      .filter((u) => isOnTeam(u, set.teamId))
      .filter((u) => u.instruments.includes(role) && !onSet.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name,
        available: isUserAvailable(u.id, calcSet, rules),
      }))
      .sort(
        (a, b) =>
          Number(b.available) - Number(a.available) ||
          a.name.localeCompare(b.name)
      );
  };

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
    <Modal
      open
      onClose={onClose}
      title="Review generated schedule"
      size="full"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Discard
          </Button>
          <Button onClick={() => onApply(sets)} disabled={busy}>
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

      {/* ── Team load: who's playing how often (top, full width) ─────── */}
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

      {/* ── One row per recurring set (grouped by label): the row scrolls
          sideways through that set's occurrences in date order. ────────── */}
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
            const capacities = resolveCapacities(set.slotCapacities);
            // Required-MD set with no MD in an MD_ROLE → couldn't close it.
            const missingMD =
              set.requiresMD &&
              !set.assignments.some(
                (a) => isMdOf(a.userId) && MD_ROLES.includes(a.role)
              );
            const conflicted = conflictedUserIds(set, rules);
            // Roles on this set no available person can fill — flagged in red.
            const cantFill = unfillableRoles(set, users, rules);
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
                    {set.requiresMD && (
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
                  {ROLE_ORDER.map((role) => {
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
                          {INSTRUMENT_LABELS[role]}
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
                                isMD={isMdOf(a.userId)}
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
              </div>
              );
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
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
