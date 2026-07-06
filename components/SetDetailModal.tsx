"use client";
// Modal showing a set's full team roster, grouped by role with empty slots
// visible.
//   • Admins can swap/remove/add people (any change resets that slot to
//     PENDING) and edit the notes.
//   • The set's worship leader can also edit the notes.
//   • Everyone else sees it read-only.
import { useEffect, useState } from "react";
import Modal from "./common/Modal";
import Button from "./common/Button";
import ExportIcsButton from "./ExportIcsButton";
import StatusBadge from "./StatusBadge";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  resolveCapacities,
  type Instrument,
} from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import type { ApiAdminUser, ApiSet } from "@/lib/types";

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
  // Slack "message team" state: only shown to admins when Slack is configured.
  const [slackConfigured, setSlackConfigured] = useState(false);
  const [slackMsg, setSlackMsg] = useState("");

  // Keep the notes textarea in sync with whichever set is open.
  useEffect(() => {
    setNotesDraft(set?.notes ?? "");
  }, [set?.id, set?.notes]);

  // Reset the delete confirmation + Slack feedback whenever a different set opens.
  useEffect(() => {
    setConfirmingDelete(false);
    setSlackMsg("");
  }, [set?.id]);

  // Is the Slack bot configured? Gates the admin "Message team on Slack" button.
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/slack/status")
      .then((r) => r.json())
      .then((d) => setSlackConfigured(!!d.enabled))
      .catch(() => setSlackConfigured(false));
  }, [isAdmin]);

  if (!set) return null;

  // The set's own team shape (falls back to the global default per role).
  const capacities = resolveCapacities(set.slotCapacities);

  const isSetWorshipLeader =
    !!currentUserId &&
    set.assignments.some(
      (a) => a.role === "WORSHIP_LEADER" && a.user.id === currentUserId
    );
  const canEditNotes = isAdmin || isSetWorshipLeader;
  const canEditTeam = isAdmin;

  const onSetUserIds = new Set(set.assignments.map((a) => a.user.id));

  // Users who play `role` and aren't already on this set (one slot per set).
  const eligibleFor = (role: Instrument) =>
    users.filter(
      (u) => u.instruments.includes(role) && !onSetUserIds.has(u.id)
    );

  async function runEdit(fn: () => Promise<Response>) {
    setBusy(true);
    try {
      await fn();
      await onChanged?.();
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
    <Modal open onClose={onClose} title={set.label ?? "Worship Set"}>
      {/* Date on the left; .ics export pinned to the top right. The event
          title carries my role(s) on this set. */}
      <div className="mb-4 flex items-start justify-between gap-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
        </p>
        <ExportIcsButton
          href={`/api/export/${set.id}`}
          label="Export set (.ics)"
          text="Export to Calendar (.ics)"
          size="sm"
        />
      </div>

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
                    // reassigns (which resets the slot to PENDING).
                    <li key={a.id} className="flex items-center gap-2">
                      <select
                        value={a.user.id}
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value
                            ? reassign(a.id, e.target.value)
                            : removeAssignment(a.id)
                        }
                        className="w-40 truncate rounded border border-gray-300 bg-white px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
                      >
                        <option value="">None</option>
                        <option value={a.user.id}>{a.user.name}</option>
                        {options.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                      <StatusBadge status={a.status} />
                    </li>
                  ) : (
                    <li key={a.id} className="flex items-center gap-2">
                      <span>{a.user.name}</span>
                      <StatusBadge status={a.status} />
                    </li>
                  )
                )}

                {/* Empty slots: a dash (read) or a "None"-default dropdown that
                    assigns someone when picked (admin). */}
                {Array.from({ length: openSlots }).map((_, i) =>
                  canEditTeam ? (
                    <li key={`add-${i}`}>
                      <select
                        value=""
                        disabled={busy}
                        onChange={(e) =>
                          e.target.value && addAssignment(role, e.target.value)
                        }
                        className="w-40 truncate rounded border border-dashed border-gray-300 bg-white px-2 py-1 text-sm text-gray-500 dark:border-gray-600 dark:bg-gray-800"
                      >
                        <option value="">None</option>
                        {options.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
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

      {/* Slack: admins can spin up a group DM for this set's team. Only shown
          when the bot is configured. */}
      {isAdmin && slackConfigured && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          <Button
            size="sm"
            variant="secondary"
            onClick={messageTeamOnSlack}
            disabled={busy}
          >
            Message team on Slack
          </Button>
          {slackMsg && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {slackMsg}
            </span>
          )}
        </div>
      )}

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
    </Modal>
  );
}
