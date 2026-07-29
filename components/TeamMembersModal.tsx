"use client";
// Members modal for one team: the current roster (with per-person remove), an
// autocomplete input to add people, the team's Slack channel + weekly-summary
// send button, and the team's delete button. Fully prop-driven so both the
// Team tab and the Org settings page can drive it with their own state.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { orgHeaders } from "@/lib/api";
import { DAY_LABELS } from "@/lib/constants";
import { minutesToTimeLabel, timeStringToMinutes } from "@/lib/dates";
import type { ApiAdminUser, ApiTeam, ApiWeeklyReminder } from "@/lib/types";

// Days ordered Monday→Sunday (DAY_LABELS is indexed 0=Sun) for the picker.
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0];

export default function TeamMembersModal({
  team,
  users,
  query,
  onQueryChange,
  busy,
  confirmingDelete,
  onConfirmDelete,
  onDelete,
  onAdd,
  onRemove,
  onSaved,
  onClose,
}: {
  team: ApiTeam | null; // null = closed
  users: ApiAdminUser[];
  query: string;
  onQueryChange: (q: string) => void;
  busy: boolean;
  confirmingDelete: boolean;
  onConfirmDelete: (confirming: boolean) => void;
  onDelete: (teamId: string) => void;
  onAdd: (user: ApiAdminUser, team: ApiTeam) => void;
  onRemove: (user: ApiAdminUser, team: ApiTeam) => void;
  onSaved: () => void; // parent refetch after the channel id changes
  onClose: () => void;
}) {
  // Slack channel input (seeded from the team when a modal opens) + the
  // outcome of the last save/send, shown inline next to the buttons.
  const [channelId, setChannelId] = useState("");
  const [slackBusy, setSlackBusy] = useState(false);
  const [slackMsg, setSlackMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  // Whether THIS team's org has connected its Slack bot. Posting a summary
  // needs the org's token, so a channel id alone isn't enough.
  const [orgSlackConnected, setOrgSlackConnected] = useState(false);
  useEffect(() => {
    setChannelId(team?.slackChannelId ?? "");
    setSlackMsg(null);
    if (!team?.orgId) {
      setOrgSlackConnected(false);
      return;
    }
    fetch(`/api/slack/status?orgId=${team.orgId}`)
      .then((r) => r.json())
      .then((d) => setOrgSlackConnected(!!d.enabled))
      .catch(() => setOrgSlackConnected(false));
  }, [team?.id, team?.slackChannelId, team?.orgId]);

  // ── This team's weekly Slack reminders (moved here from Org settings) ──
  // The modal owns them: it fetches on open and drives its own add/delete, so
  // both pages that render this modal get the feature for free. Scoped to this
  // team via the org header + a client-side filter on teamId.
  const [reminders, setReminders] = useState<ApiWeeklyReminder[] | null>(null);
  const [remDay, setRemDay] = useState(0);
  const [remTime, setRemTime] = useState("09:00");
  const [remBusy, setRemBusy] = useState(false);
  const [remError, setRemError] = useState("");

  const loadReminders = useCallback((t: ApiTeam) => {
    if (!t.orgId) return;
    fetch("/api/admin/reminders", { headers: orgHeaders(t.orgId) })
      .then((r) => (r.ok ? r.json() : []))
      .then((all: ApiWeeklyReminder[]) =>
        setReminders(all.filter((rem) => rem.teamId === t.id))
      )
      .catch(() => setReminders([]));
  }, []);

  useEffect(() => {
    setReminders(null);
    setRemError("");
    if (team) loadReminders(team);
  }, [team, loadReminders]);

  if (!team) return null;

  async function addReminder(t: ApiTeam) {
    if (!t.orgId) return;
    setRemBusy(true);
    setRemError("");
    try {
      const res = await fetch("/api/admin/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(t.orgId) },
        body: JSON.stringify({
          teamId: t.id,
          dayOfWeek: remDay,
          minute: timeStringToMinutes(remTime),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemError(data.error ?? "Could not add the reminder.");
        return;
      }
      loadReminders(t);
    } finally {
      setRemBusy(false);
    }
  }

  async function deleteReminder(t: ApiTeam, id: string) {
    await fetch(`/api/admin/reminders/${id}`, { method: "DELETE" });
    loadReminders(t);
  }

  // Set (or clear, with null) the team's auto group-chat lead time, then let
  // the parent refetch so the select reflects the saved value.
  async function saveGroupChatLead(t: ApiTeam, days: number | null) {
    await fetch(`/api/teams/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupChatLeadDays: days }),
    });
    onSaved();
  }

  async function saveChannel(t: ApiTeam) {
    setSlackBusy(true);
    setSlackMsg(null);
    try {
      const res = await fetch(`/api/teams/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slackChannelId: channelId.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      setSlackMsg(
        res.ok
          ? { ok: true, text: "Saved." }
          : { ok: false, text: data.error ?? "Could not save the channel." }
      );
      if (res.ok) onSaved();
    } finally {
      setSlackBusy(false);
    }
  }

  async function sendSummary(t: ApiTeam) {
    setSlackBusy(true);
    setSlackMsg(null);
    try {
      const res = await fetch(`/api/teams/${t.id}/slack-summary`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      setSlackMsg(
        res.ok
          ? { ok: true, text: "Summary sent to Slack." }
          : { ok: false, text: data.error ?? "Could not send the summary." }
      );
    } finally {
      setSlackBusy(false);
    }
  }

  const members = users.filter((u) => u.teams.some((t) => t.id === team.id));
  // Autocomplete: non-members whose name matches the query (top 6).
  const trimmed = query.trim().toLowerCase();
  const suggestions = trimmed
    ? users
        .filter((u) => !u.teams.some((t) => t.id === team.id))
        .filter((u) => u.name.toLowerCase().includes(trimmed))
        .slice(0, 6)
    : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={team.name}
      // Delete pinned bottom-left, Done bottom-right; both stay put while the
      // body scrolls. Delete opens a separate confirmation modal (below).
      footer={
        <>
          <Button
            size="sm"
            variant="danger"
            onClick={() => onConfirmDelete(true)}
            disabled={busy}
            className="mr-auto"
          >
            Delete team
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {/* Current roster */}
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Members ({members.length})
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody on this team yet.</p>
      ) : (
        <ul className="scrollbar-visible max-h-56 space-y-1 overflow-y-auto pr-1">
          {members.map((u) => (
            <li
              key={u.id}
              className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm dark:bg-gray-800/60"
            >
              <span>{u.name}</span>
              <button
                type="button"
                onClick={() => onRemove(u, team)}
                disabled={busy}
                aria-label={`Remove ${u.name} from ${team.name}`}
                className="rounded p-1 text-xs leading-none text-gray-400
                  hover:bg-red-50 hover:text-red-600 disabled:opacity-50
                  dark:hover:bg-red-900/30 dark:hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add a member: type a name, pick from the matches. */}
      <div className="mt-4">
        <Input
          label="Add member"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Start typing a name…"
        />
        {trimmed && (
          <ul className="mt-2 space-y-1">
            {suggestions.length === 0 ? (
              <li className="text-sm text-gray-400">No matches.</li>
            ) : (
              suggestions.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700"
                >
                  <span>{u.name}</span>
                  <Button size="sm" onClick={() => onAdd(u, team)} disabled={busy}>
                    Add
                  </Button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Slack: the channel the weekly set summary is posted to, + send. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Slack
        </p>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              label="Channel ID"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              placeholder="C0123ABCD"
            />
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => saveChannel(team)}
            disabled={
              slackBusy || channelId.trim() === (team.slackChannelId ?? "")
            }
          >
            Save
          </Button>
        </div>
        <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
          Find it in Slack under the channel&rsquo;s details → About → Channel
          ID, and invite the bot to the channel so it can post. Leave empty to
          turn summaries off.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            onClick={() => sendSummary(team)}
            disabled={slackBusy || !team.slackChannelId || !orgSlackConnected}
          >
            Send this week&rsquo;s sets
          </Button>
          {!orgSlackConnected && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Connect this org&rsquo;s Slack first (org menu → settings).
            </p>
          )}
          {slackMsg && (
            <p
              className={`text-sm font-medium ${
                slackMsg.ok
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              }`}
            >
              {slackMsg.text}
            </p>
          )}
        </div>
      </div>

      {/* Auto group chat: open a Slack group DM of a set's members some days
          before it. Best-effort — people without a linked Slack are skipped. */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Auto group chat
        </p>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Automatically start a Slack group chat with each set&rsquo;s members
          ahead of time. People who haven&rsquo;t linked Slack are skipped.
        </p>
        <div className="w-48">
          <Select
            label="Create the chat"
            value={team.groupChatLeadDays ?? ""}
            onChange={(e) =>
              saveGroupChatLead(
                team,
                e.target.value === "" ? null : Number(e.target.value)
              )
            }
          >
            <option value="">Off</option>
            <option value="1">1 day before</option>
            <option value="2">2 days before</option>
            <option value="3">3 days before</option>
            <option value="5">5 days before</option>
            <option value="7">7 days before</option>
          </Select>
        </div>
      </div>

      {/* Weekly Slack reminders for THIS team (moved here from Org settings). */}
      <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Weekly reminders
        </p>
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          Automatically post this team&rsquo;s upcoming sets to its Slack channel
          every week. Sent on a daily schedule, so the time is approximate.
        </p>

        {/* Existing reminders for this team, each with a delete. */}
        {reminders && reminders.length > 0 && (
          <ul className="mb-3 space-y-1">
            {reminders.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md bg-gray-50 px-3 py-1.5 text-sm dark:bg-gray-800/60"
              >
                <span>
                  {DAY_LABELS[r.dayOfWeek]} · {minutesToTimeLabel(r.minute)}
                </span>
                <button
                  type="button"
                  onClick={() => deleteReminder(team, r.id)}
                  aria-label={`Delete the ${DAY_LABELS[r.dayOfWeek]} reminder`}
                  className="rounded p-1 text-xs leading-none text-gray-400
                    hover:bg-red-50 hover:text-red-600
                    dark:hover:bg-red-900/30 dark:hover:text-red-400"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        {/* Add a reminder: day + time (the team is implicit here). */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32">
            <Select
              label="Day"
              value={remDay}
              onChange={(e) => setRemDay(Number(e.target.value))}
            >
              {DAY_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {DAY_LABELS[d]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Time
            </label>
            <input
              type="time"
              value={remTime}
              onChange={(e) => setRemTime(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm
                dark:border-gray-600 dark:bg-gray-900"
            />
          </div>
          <Button
            size="sm"
            onClick={() => addReminder(team)}
            disabled={remBusy}
          >
            Add
          </Button>
        </div>
        {!team.slackChannelId && (
          <p className="mt-2 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <span
              aria-hidden
              className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
            >
              !
            </span>
            Add a Slack channel ID above for reminders to post.
          </p>
        )}
        {remError && (
          <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
            {remError}
          </p>
        )}
      </div>

      {/* Delete confirmation: a separate stacked modal so it reads as a
          deliberate, blocking step (its sets survive, open to everyone). */}
      {confirmingDelete && (
        <Modal
          open
          onClose={() => onConfirmDelete(false)}
          title="Delete team?"
          footer={
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onConfirmDelete(false)}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => onDelete(team.id)}
                disabled={busy}
              >
                Confirm delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Delete <span className="font-medium">{team.name}</span>? Its sets are
            kept, open to everyone.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
