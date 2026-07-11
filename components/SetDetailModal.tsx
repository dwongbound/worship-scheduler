"use client";
// Modal showing a set's full team roster, grouped by role with empty slots
// visible.
//   • Admins can swap/remove/add people (any change resets that slot to
//     PENDING), auto-fill the open slots, remove individual role slots (the
//     "✕" beside each row), and edit the notes.
//   • The set's worship leader can also edit the notes.
//   • Everyone else sees it read-only.
import { useEffect, useMemo, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import InfoTooltip from "./common/InfoTooltip";
import LoadingDots from "./common/LoadingDots";
import ExportIcsButton from "./ExportIcsButton";
import StatusBadge from "./StatusBadge";
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
import { isOnTeam } from "@/lib/stagedPlan";
import SetHistoryEntry from "./SetHistoryEntry";
import type {
  ApiAdminUser,
  ApiAssignment,
  ApiSet,
  ApiSetHistoryEvent,
} from "@/lib/types";

// The Slack logo mark (four lozenges), inline SVG per the no-raster-assets
// convention. Sized to sit inside a small button next to its label.
function SlackIcon() {
  return (
    <svg viewBox="0 0 122.8 122.8" aria-hidden className="h-3.5 w-3.5 shrink-0">
      <path
        d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9zm6.5 0c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z"
        fill="#e01e5a"
      />
      <path
        d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2zm0 6.5c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z"
        fill="#36c5f0"
      />
      <path
        d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2zm-6.5 0c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z"
        fill="#2eb67d"
      />
      <path
        d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9zm0-6.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z"
        fill="#ecb22e"
      />
    </svg>
  );
}

interface SetDetailModalProps {
  set: ApiSet | null; // null = closed
  onClose: () => void;
  currentUserId?: string;
  isAdmin?: boolean;
  users?: ApiAdminUser[]; // for the admin assignment dropdowns
  onChanged?: () => void | Promise<void>; // refetch after an edit
}

export default function SetDetailModal({
  set,
  onClose,
  currentUserId,
  isAdmin = false,
  users = [],
  onChanged,
}: SetDetailModalProps) {
  const [notesDraft, setNotesDraft] = useState("");
  const [busy, setBusy] = useState(false);
  // Two-step delete: the button flips to "Confirm delete" before firing.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // "Auto schedule" in flight (busy also goes true; this picks which button
  // shows the dots).
  const [autofilling, setAutofilling] = useState(false);
  // Filled slot whose "✕" was clicked — a confirm modal asks before removing
  // the person along with their slot. (Empty slots are removed right away.)
  const [slotToDelete, setSlotToDelete] = useState<ApiAssignment | null>(null);
  // Slack "message team" state: only shown to admins when Slack is configured.
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [slackMsg, setSlackMsg] = useState("");

  // The set's activity log (History section, bottom of the modal).
  const [history, setHistory] = useState<ApiSetHistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Keep the notes textarea in sync with whichever set is open.
  useEffect(() => {
    setNotesDraft(set?.notes ?? "");
  }, [set?.id, set?.notes]);

  // Reset the delete confirmations + Slack feedback whenever a different set opens.
  useEffect(() => {
    setConfirmingDelete(false);
    setSlotToDelete(null);
    setSlackMsg("");
  }, [set?.id]);

  // Is the Slack bot configured? Gates the admin "Slack Team" button.
  // Only fetch while a set is actually open — this modal is always mounted (with
  // set=null) on the calendar page, so gating on `set` avoids a wasted request
  // (and a doubled one under React's dev Strict Mode) on every calendar load.
  useEffect(() => {
    if (!isAdmin || !set) return;
    fetch("/api/slack/status")
      .then((r) => r.json())
      .then((d) => setSlackConfigured(!!d.enabled))
      .catch(() => setSlackConfigured(false));
  }, [isAdmin, set]);

  // History section: fetched fresh whenever a (different) set opens, and
  // refreshed again after any edit made from this modal (see runEdit).
  function refetchHistory(id: string) {
    setHistoryLoading(true);
    fetch(`/api/sets/${id}/history`)
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d) ? d : []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }

  const setId = set?.id;
  useEffect(() => {
    if (setId) refetchHistory(setId);
  }, [setId]);

  // Flatten every user's unavailability into scheduler rules once, so the
  // dropdowns can flag who can't serve at this set's time. (Hook stays above
  // the early return so hook order is stable.)
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

  if (!set) return null;
  // Narrowed copy of the id for closures (nested functions below don't
  // retain TS's null-check narrowing of the `set` prop itself).
  const currentSetId = set.id;

  // The set's own team shape (falls back to the global default per role).
  const capacities = resolveCapacities(set.slotCapacities);

  // A required-MD set is "unclosed" until an MD is assigned to an MD_ROLE
  // (keys, electric guitar, or bass — the only roles an MD can lead from).
  const hasMD = set.assignments.some(
    (a) => a.user.isMD && MD_ROLES.includes(a.role)
  );
  const missingMD = set.requiresMD && !hasMD;

  // This set as the scheduler sees it, for availability checks.
  const calcSet = {
    id: set.id,
    startsAt: new Date(set.startsAt),
    durationMinutes: set.durationMinutes,
  };

  const isSetWorshipLeader =
    !!currentUserId &&
    set.assignments.some(
      (a) => a.role === "WORSHIP_LEADER" && a.user.id === currentUserId
    );
  const canEditNotes = isAdmin || isSetWorshipLeader;
  const canEditTeam = isAdmin;

  // Options for a role's dropdown: users who play `role` and aren't already in
  // THAT role on this set (a person may hold several roles on one set, so we
  // only exclude them from a role they already fill). Each is flagged with
  // whether they're free at this set's time; available people sort first.
  const eligibleFor = (role: Instrument): PlayerOption[] => {
    const inThisRole = new Set(
      set.assignments.filter((a) => a.role === role).map((a) => a.user.id)
    );
    return users
      // Only this set's team members are offered (no team = open to everyone).
      .filter((u) => isOnTeam(u, set.teamId ?? set.team?.id))
      .filter((u) => u.instruments.includes(role) && !inThisRole.has(u.id))
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

  async function runEdit(fn: () => Promise<Response>) {
    setBusy(true);
    try {
      await fn();
      await onChanged?.();
      refetchHistory(currentSetId);
    } finally {
      setBusy(false);
    }
  }

  const reassign = (assignmentId: string, userId: string) =>
    runEdit(() =>
      fetch(`/api/admin/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
    );

  const removeAssignment = (assignmentId: string) =>
    runEdit(() =>
      fetch(`/api/admin/assignments/${assignmentId}`, { method: "DELETE" })
    );

  const addAssignment = (role: Instrument, userId: string) =>
    runEdit(() =>
      fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: set.id, userId, role }),
      })
    );

  // Fill the empty slots server-side, keeping everyone already assigned in
  // place (their slots are constraints the fill works around).
  const autoSchedule = async () => {
    setAutofilling(true);
    try {
      await runEdit(() =>
        fetch(`/api/admin/sets/${currentSetId}/autofill`, { method: "POST" })
      );
    } finally {
      setAutofilling(false);
    }
  };

  // Remove ONE slot of a role from this set (capacity − 1). For a filled slot
  // pass its assignmentId — the person is unassigned in the same request.
  const deleteSlot = (role: Instrument, assignmentId?: string) => {
    setSlotToDelete(null);
    const query = assignmentId ? `?assignmentId=${assignmentId}` : "";
    return runEdit(() =>
      fetch(`/api/admin/sets/${currentSetId}/roles/${role}${query}`, {
        method: "DELETE",
      })
    );
  };

  const saveNotes = () =>
    runEdit(() =>
      fetch(`/api/sets/${set.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notesDraft }),
      })
    );

  // Open a Slack group DM among this set's assigned team and post an intro.
  const messageTeamOnSlack = async () => {
    setBusy(true);
    setSlackMsg("");
    try {
      const res = await fetch(`/api/admin/sets/${set.id}/slack-group`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      setSlackMsg(
        res.ok ? "Group chat created on Slack." : data.error ?? "Could not message the team."
      );
    } finally {
      setBusy(false);
    }
  };

  // Delete the whole set (assignments cascade). Closes the modal afterwards.
  const deleteSet = async () => {
    setBusy(true);
    try {
      await fetch(`/api/sets/${set.id}`, { method: "DELETE" });
      await onChanged?.();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    // While the slot-delete confirm is stacked on top, Escape/overlay on the
    // outer modal only dismiss the confirm (both modals listen for Escape).
    <Modal
      open
      onClose={slotToDelete ? () => setSlotToDelete(null) : onClose}
      title={set.label ?? "Worship Set"}
      subtitle={
        <>
          {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
          {set.team && <> · {set.team.name}</>}
          {/* Which org this set belongs to — matters in "All orgs" views. */}
          {set.org && (
            <span className="ml-2 inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              {set.org.name}
            </span>
          )}
        </>
      }
    >
      {/* Action bar right below the title: Auto schedule (+ Slack) on the
          left, .ics export on the right. The (i) tooltip opens DOWNWARD so
          it isn't clipped by the top of the modal. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3 dark:border-gray-700">
        <div className="flex items-center gap-1.5">
          {canEditTeam && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={autoSchedule}
                disabled={busy}
              >
                {autofilling ? <LoadingDots size="sm" /> : "Auto schedule"}
              </Button>
              <InfoTooltip
                side="bottom"
                text="Fills this set's empty slots with available team members,
                  preferring people who aren't already serving in the
                  surrounding week. People already assigned keep their roles —
                  the fill works around them."
              />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && slackConfigured && (
            <Button
              size="sm"
              variant="secondary"
              onClick={messageTeamOnSlack}
              disabled={busy}
            >
              <span className="flex items-center gap-1.5">
                <SlackIcon />
                Slack Team
              </span>
            </Button>
          )}
          <ExportIcsButton
            href={`/api/export/${set.id}`}
            label="Export set (.ics)"
            text="Export (.ics)"
            size="sm"
          />
        </div>
      </div>
      {isAdmin && slackConfigured && slackMsg && (
        <p className="-mt-1 mb-4 text-sm text-gray-600 dark:text-gray-400">
          {slackMsg}
        </p>
      )}

      {/* Amber warning while a required-MD set still has no musical director;
          nothing once an MD is on the team (the * MD marker says enough). */}
      {set.requiresMD && missingMD && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
          ⚠ This set requires an MD but none is assigned yet.
        </p>
      )}

      <ul className="space-y-3">
        {ROLE_ORDER.map((role) => {
          const filled = set.assignments.filter((a) => a.role === role);
          const capacity = capacities[role];
          const openSlots = Math.max(0, capacity - filled.length);
          const options = eligibleFor(role);

          // Roles this set doesn't want (capacity 0) and has nobody in are
          // hidden entirely — no point showing an empty "0/0" row.
          if (capacity === 0 && filled.length === 0) return null;

          return (
            <li key={role} className="text-sm">
              <span className="font-medium">
                {INSTRUMENT_LABELS[role]}
                {capacity > 1 && (
                  <span className="ml-1 text-xs text-gray-500">
                    ({filled.length}/{capacity})
                  </span>
                )}
              </span>

              <ul className="mt-1 space-y-1 pl-4">
                {filled.map((a) =>
                  canEditTeam ? (
                    // Selecting "None" removes the person; picking another
                    // reassigns (which resets the slot to PENDING). The "✕"
                    // deletes this whole slot — confirmed first, since the
                    // person goes with it.
                    <li key={a.id} className="flex items-center gap-2">
                      <SlotDeleteButton
                        label={`Remove ${INSTRUMENT_LABELS[role]} slot (${a.user.name})`}
                        disabled={busy}
                        onClick={() => setSlotToDelete(a)}
                      />
                      <PlayerSelect
                        selected={{ id: a.user.id, name: a.user.name }}
                        options={options}
                        disabled={busy}
                        onChange={(userId) =>
                          userId
                            ? reassign(a.id, userId)
                            : removeAssignment(a.id)
                        }
                      />
                      {a.user.isMD && (
                        <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
                          * (MD)
                        </span>
                      )}
                      <StatusBadge status={a.status} />
                    </li>
                  ) : (
                    <li key={a.id} className="flex items-center gap-2">
                      <span>
                        {a.user.name}
                        {a.user.isMD && (
                          <span className="ml-1 font-medium text-indigo-600 dark:text-indigo-400">
                            * (MD)
                          </span>
                        )}
                      </span>
                      <StatusBadge status={a.status} />
                    </li>
                  )
                )}

                {/* Empty slots: a dash (read) or a "None"-default dropdown that
                    assigns someone when picked (admin). */}
                {Array.from({ length: openSlots }).map((_, i) =>
                  canEditTeam ? (
                    // Empty slot: its "✕" removes the slot right away (nobody
                    // is affected, so no confirm step).
                    <li key={`add-${i}`} className="flex items-center gap-2">
                      <SlotDeleteButton
                        label={`Remove empty ${INSTRUMENT_LABELS[role]} slot`}
                        disabled={busy}
                        onClick={() => deleteSlot(role)}
                      />
                      <PlayerSelect
                        selected={null}
                        options={options}
                        disabled={busy}
                        dashed
                        onChange={(userId) =>
                          userId && addAssignment(role, userId)
                        }
                      />
                    </li>
                  ) : (
                    <li key={`empty-${i}`} className="text-gray-400">
                      —
                    </li>
                  )
                )}
              </ul>
            </li>
          );
        })}
      </ul>

      {/* Notes (bottom): editable by admins + the worship leader. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Notes
        </p>
        {canEditNotes ? (
          <div className="space-y-2">
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={2}
              placeholder="e.g. Communion Sunday — extra song at the end"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                dark:border-gray-600 dark:bg-gray-800"
            />
            {notesDraft !== (set.notes ?? "") && (
              <Button size="sm" onClick={saveNotes} disabled={busy}>
                Save notes
              </Button>
            )}
          </div>
        ) : set.notes ? (
          <p className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
            {set.notes}
          </p>
        ) : (
          <p className="text-sm text-gray-400">No notes.</p>
        )}
      </div>

      {/* History: a chronological log of who confirmed, who was manually
          swapped/added/removed (and by which admin), and swap requests. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          History
        </p>
        {historyLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-gray-400">No activity yet.</p>
        ) : (
          <ul className="max-h-48 space-y-2.5 overflow-y-auto">
            {history.map((event) => (
              <SetHistoryEntry key={event.id} event={event} />
            ))}
          </ul>
        )}
      </div>

      {/* Danger zone: admins can delete the whole set (two-step confirm). */}
      {isAdmin && (
        <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          {confirmingDelete ? (
            <>
              <span className="mr-auto text-sm text-gray-600 dark:text-gray-400">
                Delete this set and its whole team?
              </span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={deleteSet}
                disabled={busy}
              >
                Confirm delete
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              Delete set
            </Button>
          )}
        </div>
      )}

      {/* Stacked confirm for removing a slot that still has a person in it. */}
      {slotToDelete && (
        <Modal
          open
          onClose={() => setSlotToDelete(null)}
          title={`Remove ${INSTRUMENT_LABELS[slotToDelete.role]} slot?`}
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {slotToDelete.user.name} is assigned to this{" "}
            {INSTRUMENT_LABELS[slotToDelete.role]} slot. Removing the slot also
            removes them from this set.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSlotToDelete(null)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => deleteSlot(slotToDelete.role, slotToDelete.id)}
              disabled={busy}
            >
              Remove slot
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

// The small "✕" to the left of each slot row (admin only): deletes that one
// slot of the role from this set.
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
      className="rounded p-0.5 text-xs leading-none text-gray-400
        hover:bg-red-50 hover:text-red-600 disabled:opacity-50
        dark:hover:bg-red-900/30 dark:hover:text-red-400"
    >
      ✕
    </button>
  );
}
