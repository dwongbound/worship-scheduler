"use client";
// Review step for the Create tab's "Generate" flow. The scheduler proposes a
// plan (POST /api/admin/generate, a dry run); this modal lets the admin move
// people around before committing. Every edit here is LOCAL state — nothing
// is saved (and no emails/Slack fire) until "Apply schedule" posts the final
// plan to /api/admin/generate/apply.
import { useEffect, useMemo, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import Badge from "./common/Badge";
import LoadingDots from "./common/LoadingDots";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  resolveCapacities,
  type Instrument,
} from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
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

  if (!plan) return null;

  const totalAssignments = sets.reduce((n, s) => n + s.assignments.length, 0);

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

  // Users who play `role` and aren't already on this set (one slot per set).
  const eligibleFor = (set: StagedSet, role: Instrument) => {
    const onSet = new Set(set.assignments.map((a) => a.userId));
    return users.filter(
      (u) => u.instruments.includes(role) && !onSet.has(u.id)
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
    <Modal open onClose={onClose} title="Review generated schedule">
      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        Staged <strong>{sets.length}</strong> set
        {sets.length === 1 ? "" : "s"} with{" "}
        <strong>{totalAssignments}</strong> assignment
        {totalAssignments === 1 ? "" : "s"}. Adjust anyone below, then apply —
        nothing is saved (or announced) until you do.
        {plan.skipped > 0 &&
          ` ${plan.skipped} already-staffed set${
            plan.skipped === 1 ? "" : "s"
          } left untouched.`}
      </p>

      <ul className="space-y-3">
        {sets.map((set, idx) => {
          const capacities = resolveCapacities(set.slotCapacities);
          return (
            <li
              key={set.startsAt}
              className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">
                    {set.label ?? "Worship Set"}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
                  </p>
                </div>
                {/* Whether Apply creates this set or fills one that exists. */}
                <Badge tone={set.existing ? "amber" : "green"}>
                  {set.existing ? "Fills existing" : "New set"}
                </Badge>
              </div>

              <ul className="space-y-2">
                {ROLE_ORDER.map((role) => {
                  const capacity = capacities[role];
                  const filled = set.assignments.filter((a) => a.role === role);
                  const openSlots = Math.max(0, capacity - filled.length);
                  const options = eligibleFor(set, role);

                  // Hide roles this set doesn't want and nobody's in.
                  if (capacity === 0 && filled.length === 0) return null;

                  return (
                    <li key={role} className="text-sm">
                      <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        {INSTRUMENT_LABELS[role]}
                        {capacity > 1 && (
                          <span className="ml-1 text-gray-400">
                            ({filled.length}/{capacity})
                          </span>
                        )}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5 pl-1">
                        {/* Filled slots: "None" removes, another name swaps. */}
                        {filled.map((a) => (
                          <select
                            key={`${a.userId}-${role}`}
                            value={a.userId}
                            disabled={busy}
                            onChange={(e) =>
                              e.target.value
                                ? reassign(idx, a.userId, role, e.target.value)
                                : remove(idx, a.userId, role)
                            }
                            className="w-40 truncate rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                          >
                            <option value="">None</option>
                            <option value={a.userId}>{nameOf(a.userId)}</option>
                            {options.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        ))}

                        {/* Empty slots: pick someone to fill them. */}
                        {Array.from({ length: openSlots }).map((_, i) => (
                          <select
                            key={`add-${role}-${i}`}
                            value=""
                            disabled={busy}
                            onChange={(e) =>
                              e.target.value && add(idx, role, e.target.value)
                            }
                            className="w-40 truncate rounded border border-dashed border-gray-300 bg-white px-2 py-1 text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800"
                          >
                            <option value="">Add…</option>
                            {options.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.name}
                              </option>
                            ))}
                          </select>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {/* Sticky action bar so Apply/Discard stay reachable while scrolling. */}
      <div className="sticky bottom-0 -mx-6 -mb-6 mt-4 flex items-center justify-end gap-2 border-t border-gray-200 bg-white px-6 py-3 dark:border-gray-700 dark:bg-gray-800">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Discard
        </Button>
        <Button onClick={() => onApply(sets)} disabled={busy}>
          {busy ? <LoadingDots size="sm" /> : "Apply schedule"}
        </Button>
      </div>
    </Modal>
  );
}
