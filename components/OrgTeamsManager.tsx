"use client";
// Org settings: full team management (create/delete teams, manage members and
// each team's Slack channel via the shared members modal) plus the scheduled
// weekly Slack reminders table. Admin-only; every request is scoped to `orgId`
// via the x-org-id header. Keyed on orgId by the parent so it remounts on an
// org switch. Mirrors the team management the /team tab used to hold.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Select from "@/components/common/Select";
import TeamMembersModal from "@/components/TeamMembersModal";
import { TEAMS_CHANGED_EVENT } from "@/components/Navbar";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { DAY_LABELS } from "@/lib/constants";
import { minutesToTimeLabel, timeStringToMinutes } from "@/lib/dates";
import type { ApiAdminUser, ApiTeam, ApiWeeklyReminder } from "@/lib/types";

// Days ordered Monday→Sunday (labels are indexed 0=Sun) for the picker.
const DAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0];

export default function OrgTeamsManager({ orgId }: { orgId: string }) {
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  const [reminders, setReminders] = useState<ApiWeeklyReminder[] | null>(null);

  // Team management state (create + members modal).
  const [newTeamName, setNewTeamName] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [confirmingTeamId, setConfirmingTeamId] = useState<string | null>(null);

  // Reminder "add" form state.
  const [remTeamId, setRemTeamId] = useState("");
  const [remDay, setRemDay] = useState(0);
  const [remTime, setRemTime] = useState("09:00");
  const [remBusy, setRemBusy] = useState(false);
  const [remError, setRemError] = useState("");

  const loadTeams = useCallback(() => {
    fetchJsonArray<ApiTeam>(`/api/teams?orgId=${orgId}`).then(setTeams);
  }, [orgId]);
  const loadUsers = useCallback(() => {
    fetchJsonArray<ApiAdminUser>("/api/admin/users", {
      headers: orgHeaders(orgId),
    }).then(setUsers);
  }, [orgId]);
  const loadReminders = useCallback(() => {
    fetchJsonArray<ApiWeeklyReminder>("/api/admin/reminders", {
      headers: orgHeaders(orgId),
    }).then(setReminders);
  }, [orgId]);

  useEffect(() => {
    loadTeams();
    loadUsers();
    loadReminders();
  }, [loadTeams, loadUsers, loadReminders]);

  // ── Teams ────────────────────────────────────────────────────────────
  async function addTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setTeamBusy(true);
    setTeamError("");
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(orgId) },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTeamError(data.error ?? "Could not add the team.");
        return;
      }
      setNewTeamName("");
      setAddingTeam(false);
      loadTeams();
    } finally {
      setTeamBusy(false);
    }
  }

  async function deleteTeam(id: string) {
    setConfirmingTeamId(null);
    setOpenTeamId(null);
    setTeamBusy(true);
    try {
      await fetch(`/api/teams/${id}`, { method: "DELETE" });
      loadTeams();
      loadUsers();
      loadReminders(); // its reminders cascade away
      window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
    } finally {
      setTeamBusy(false);
    }
  }

  // Member add/remove from the modal: optimistic user update, then PATCH.
  async function patchUserTeams(user: ApiAdminUser, nextTeams: ApiTeam[]) {
    setUsers(
      (prev) =>
        prev?.map((u) => (u.id === user.id ? { ...u, teams: nextTeams } : u)) ??
        prev
    );
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders(orgId) },
      body: JSON.stringify({ teamIds: nextTeams.map((t) => t.id) }),
    });
    if (!res.ok) loadUsers();
    window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
  }

  const memberCount = (teamId: string) =>
    users?.filter((u) => u.teams.some((t) => t.id === teamId)).length ?? 0;

  // ── Reminders ────────────────────────────────────────────────────────
  async function addReminder() {
    const teamId = remTeamId || teams?.[0]?.id;
    if (!teamId) return;
    setRemBusy(true);
    setRemError("");
    try {
      const res = await fetch("/api/admin/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(orgId) },
        body: JSON.stringify({
          teamId,
          dayOfWeek: remDay,
          minute: timeStringToMinutes(remTime),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRemError(data.error ?? "Could not add the reminder.");
        return;
      }
      loadReminders();
    } finally {
      setRemBusy(false);
    }
  }

  async function deleteReminder(id: string) {
    await fetch(`/api/admin/reminders/${id}`, { method: "DELETE" });
    loadReminders();
  }

  return (
    <div className="mt-6 space-y-6 border-t border-gray-200 pt-6 dark:border-gray-700">
      {/* Teams */}
      <div>
        <p className="mb-1 text-sm font-medium">Teams</p>
        <p className="mb-3 text-sm text-gray-500">
          Every set belongs to a team; only its members are scheduled on it.
          Click a team to manage members and its Slack channel.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(teams ?? []).map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                setOpenTeamId(team.id);
                setMemberQuery("");
                setConfirmingTeamId(null);
              }}
              className="flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-sm
                text-indigo-900 transition-colors hover:bg-indigo-100
                dark:bg-indigo-500/15 dark:text-indigo-100 dark:hover:bg-indigo-500/25"
            >
              <span className="font-medium">{team.name}</span>
              <span className="text-xs text-indigo-500/80 dark:text-indigo-200/60">
                {memberCount(team.id)}{" "}
                {memberCount(team.id) === 1 ? "member" : "members"}
              </span>
            </button>
          ))}

          {addingTeam ? (
            <form
              className="flex items-center gap-1.5 rounded-full border border-dashed border-gray-300 py-0.5 pl-3 pr-1 dark:border-gray-600"
              onSubmit={(e) => {
                e.preventDefault();
                addTeam();
              }}
            >
              <input
                autoFocus
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setAddingTeam(false);
                    setNewTeamName("");
                  }
                }}
                placeholder="e.g. Youth Team"
                aria-label="New team name"
                className="w-36 bg-transparent text-sm focus:outline-none"
              />
              <Button size="sm" type="submit" disabled={teamBusy || !newTeamName.trim()}>
                Add
              </Button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setNewTeamName("");
                setAddingTeam(true);
              }}
              className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-sm
                text-gray-500 transition-colors hover:border-indigo-400 hover:text-indigo-600
                dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-500 dark:hover:text-indigo-400"
            >
              + Add team
            </button>
          )}
        </div>
        {teamError && (
          <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
            {teamError}
          </p>
        )}
      </div>

      {/* Weekly Slack reminders */}
      <div>
        <p className="mb-1 text-sm font-medium">Weekly Slack reminders</p>
        <p className="mb-3 text-sm text-gray-500">
          Automatically post a team&rsquo;s upcoming sets to its Slack channel
          every week. Sent on a daily schedule, so the time is approximate.
        </p>

        {/* Add form */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[10rem] flex-1">
            <Select
              label="Team"
              value={remTeamId || teams?.[0]?.id || ""}
              onChange={(e) => setRemTeamId(e.target.value)}
            >
              {(teams ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
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
            onClick={addReminder}
            disabled={remBusy || !teams || teams.length === 0}
          >
            Add
          </Button>
        </div>
        {remError && (
          <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
            {remError}
          </p>
        )}

        {/* Table */}
        {reminders && reminders.length > 0 && (
          <table className="mt-4 w-full text-left text-sm">
            <thead className="border-b border-gray-200 text-gray-500 dark:border-gray-700">
              <tr>
                <th className="py-2 pr-4">Team</th>
                <th className="py-2 pr-4">When</th>
                <th className="py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {reminders.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-gray-100 last:border-0 dark:border-gray-700/50"
                >
                  <td className="py-2 pr-4 font-medium">
                    {r.teamName}
                    {!r.teamSlackChannelId && (
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400">
                        <span
                          aria-hidden
                          className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-[10px] font-bold text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
                        >
                          !
                        </span>
                        Add Slack ID to team
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {DAY_LABELS[r.dayOfWeek]} · {minutesToTimeLabel(r.minute)}
                  </td>
                  <td className="py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                      onClick={() => deleteReminder(r.id)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <TeamMembersModal
        team={teams?.find((t) => t.id === openTeamId) ?? null}
        users={users ?? []}
        query={memberQuery}
        onQueryChange={setMemberQuery}
        busy={teamBusy}
        confirmingDelete={confirmingTeamId === openTeamId}
        onConfirmDelete={(confirming) =>
          setConfirmingTeamId(confirming ? openTeamId : null)
        }
        onDelete={deleteTeam}
        onAdd={(user, team) => {
          if (user.teams.some((t) => t.id === team.id)) return;
          patchUserTeams(user, [...user.teams, team]);
        }}
        onRemove={(user, team) =>
          patchUserTeams(
            user,
            user.teams.filter((t) => t.id !== team.id)
          )
        }
        onSaved={loadTeams}
        onClose={() => setOpenTeamId(null)}
      />
    </div>
  );
}
