"use client";
// Members modal for one team: the current roster (with per-person remove), an
// autocomplete input to add people, the team's Slack channel + weekly-summary
// send button, and the team's delete button. Fully prop-driven so both the
// Team tab and the Org settings page can drive it with their own state.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import type { ApiAdminUser, ApiTeam } from "@/lib/types";

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

  if (!team) return null;

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
    <Modal open onClose={onClose} title={team.name}>
      {/* Current roster */}
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Members ({members.length})
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-gray-400">Nobody on this team yet.</p>
      ) : (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
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

      {/* Danger zone: delete the team (its sets survive, open to everyone). */}
      <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
        {confirmingDelete ? (
          <>
            <span className="mr-auto text-sm text-gray-600 dark:text-gray-400">
              Delete this team? Its sets are kept, open to everyone.
            </span>
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
        ) : (
          <Button
            size="sm"
            variant="danger"
            onClick={() => onConfirmDelete(true)}
            disabled={busy}
          >
            Delete team
          </Button>
        )}
      </div>
    </Modal>
  );
}
