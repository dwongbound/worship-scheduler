"use client";
// Org settings: full team management (create/delete teams, manage members,
// each team's Slack channel, and its weekly Slack reminders — all via the
// shared members modal). Admin-only; every request is scoped to `orgId` via
// the x-org-id header. Keyed on orgId by the parent so it remounts on an org
// switch. Mirrors the team management the /team tab used to hold.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import TeamMembersModal from "@/components/TeamMembersModal";
import { TEAMS_CHANGED_EVENT } from "@/components/Navbar";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import type { ApiAdminUser, ApiTeam, ApiTeamRole } from "@/lib/types";

export default function OrgTeamsManager({ orgId }: { orgId: string }) {
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);

  // Team management state (create + members modal).
  const [newTeamName, setNewTeamName] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [confirmingTeamId, setConfirmingTeamId] = useState<string | null>(null);
  // "Include in all group chats": the type-ahead is closed until you click the
  // dashed chip. Listing every member instead would stop scaling the moment an
  // org has more than a screenful of people.
  const [addingGroupChatPerson, setAddingGroupChatPerson] = useState(false);
  const [groupChatQuery, setGroupChatQuery] = useState("");

  const loadTeams = useCallback(() => {
    fetchJsonArray<ApiTeam>(`/api/teams?orgId=${orgId}`).then(setTeams);
  }, [orgId]);
  const loadUsers = useCallback(() => {
    fetchJsonArray<ApiAdminUser>("/api/admin/users", {
      headers: orgHeaders(orgId),
    }).then(setUsers);
  }, [orgId]);

  useEffect(() => {
    loadTeams();
    loadUsers();
  }, [loadTeams, loadUsers]);

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
      window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
    } finally {
      setTeamBusy(false);
    }
  }

  // Member add/remove from the modal: optimistic user update, then PATCH.
  async function patchUserTeams(user: ApiAdminUser, nextTeams: ApiTeamRole[]) {
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

  // Flip a member's per-team "active" flag from the members modal. Inactive =
  // not auto-scheduled on that team; they stay pickable by hand, flagged
  // "(inactive)". Optimistic, then PATCH; reload from the server on failure.
  async function setTeamActive(
    user: ApiAdminUser,
    teamId: string,
    active: boolean
  ) {
    setUsers(
      (prev) =>
        prev?.map((u) =>
          u.id === user.id
            ? {
                ...u,
                teams: u.teams.map((t) =>
                  t.id === teamId ? { ...t, active } : t
                ),
              }
            : u
        ) ?? prev
    );
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders(orgId) },
      body: JSON.stringify({ teamActive: [{ teamId, active }] }),
    });
    if (!res.ok) loadUsers();
  }

  // Who's currently included, and who the type-ahead is offering. Suggestions
  // only exist once something is typed, and are capped — the point of the
  // search is that this never renders the whole org.
  const groupChatAlways = (users ?? []).filter((u) => u.alwaysInGroupChats);
  const groupChatTrimmed = groupChatQuery.trim().toLowerCase();
  const groupChatMatches = groupChatTrimmed
    ? (users ?? [])
        .filter((u) => !u.alwaysInGroupChats)
        .filter((u) => u.name.toLowerCase().includes(groupChatTrimmed))
        .slice(0, 6)
    : [];

  const closeGroupChatSearch = () => {
    setAddingGroupChatPerson(false);
    setGroupChatQuery("");
  };
  // Adding leaves the box open and empty, so several people go in one after
  // another without reopening it each time.
  const addToGroupChats = (user: ApiAdminUser) => {
    setGroupChatQuery("");
    setAlwaysInGroupChats(user, true);
  };

  const memberCount = (teamId: string) =>
    users?.filter((u) => u.teams.some((t) => t.id === teamId)).length ?? 0;

  // Toggle a member's "add me to every group chat this org creates" flag
  // (optimistic, then PATCH; revert to server state on failure).
  async function setAlwaysInGroupChats(user: ApiAdminUser, value: boolean) {
    setUsers(
      (prev) =>
        prev?.map((u) =>
          u.id === user.id ? { ...u, alwaysInGroupChats: value } : u
        ) ?? prev
    );
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders(orgId) },
      body: JSON.stringify({ alwaysInGroupChats: value }),
    });
    if (!res.ok) loadUsers();
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

      {/* Group-chat always-invites: people added to EVERY Slack group chat this
          org creates, even for sets they aren't assigned to. */}
      <div>
        <p className="mb-1 text-sm font-medium">Include in all group chats</p>
        <p className="mb-3 text-sm text-gray-500">
          These people are added to every Slack group chat this org creates —
          even sets they aren&rsquo;t on. They still need a linked Slack account.
        </p>
        {!users || users.length === 0 ? (
          <p className="text-sm text-gray-400">No members yet.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Only the people actually included — this is a short list by
                nature, and the org's whole roster isn't. */}
            {groupChatAlways.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 py-1 pl-3 pr-1.5 text-sm font-medium text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200"
              >
                {u.name}
                {/* They'll be skipped until they link Slack — worth saying on
                    the chip, since adding them here looks like it's enough. */}
                {!u.slackConnected && (
                  <span
                    title="No Slack account linked yet — they'll be skipped until they link one."
                    className="text-xs font-normal text-indigo-600/70 dark:text-indigo-300/70"
                  >
                    no Slack
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setAlwaysInGroupChats(u, false)}
                  aria-label={`Remove ${u.name}`}
                  title="Remove"
                  className="flex h-4 w-4 items-center justify-center rounded-full text-indigo-600 transition-colors hover:bg-indigo-200 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-500/40 dark:hover:text-white"
                >
                  <svg
                    viewBox="0 0 14 14"
                    className="h-2.5 w-2.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                  </svg>
                </button>
              </span>
            ))}

            {addingGroupChatPerson ? (
              <div className="relative">
                <input
                  autoFocus
                  value={groupChatQuery}
                  onChange={(e) => setGroupChatQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") closeGroupChatSearch();
                    // Enter takes the top match, so a full name can be typed
                    // straight through without reaching for the mouse.
                    if (e.key === "Enter" && groupChatMatches[0]) {
                      e.preventDefault();
                      addToGroupChats(groupChatMatches[0]);
                    }
                  }}
                  // Closing on blur would fire before a click on a suggestion
                  // registers; the suggestions cancel that with onMouseDown.
                  onBlur={closeGroupChatSearch}
                  placeholder="Start typing a name…"
                  aria-label="Add someone to every group chat"
                  className="w-56 rounded-full border border-gray-300 bg-white px-3 py-1 text-sm
                    focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                    dark:border-gray-600 dark:bg-gray-800"
                />
                {groupChatQuery.trim() && (
                  <ul className="absolute left-0 top-full z-10 mt-1 max-h-56 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                    {groupChatMatches.length === 0 ? (
                      <li className="px-3 py-1.5 text-sm text-gray-400">
                        No matches.
                      </li>
                    ) : (
                      groupChatMatches.map((u) => (
                        <li key={u.id}>
                          <button
                            type="button"
                            // Keep the input focused so the click lands.
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addToGroupChats(u)}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                          >
                            <span>{u.name}</span>
                            {!u.slackConnected && (
                              <span className="text-xs text-gray-400">
                                (no Slack linked)
                              </span>
                            )}
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingGroupChatPerson(true)}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-400 px-3 py-1 text-sm text-gray-500 transition-colors hover:border-indigo-500 hover:text-indigo-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-indigo-400 dark:hover:text-indigo-300"
              >
                + Add person
              </button>
            )}
          </div>
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
          // New member starts with no roles on the team (they/an admin pick them).
          patchUserTeams(user, [
            ...user.teams,
            { id: team.id, name: team.name, roles: [], active: true },
          ]);
          setMemberQuery(""); // clear so they can type the next name
        }}
        onRemove={(user, team) =>
          patchUserTeams(
            user,
            user.teams.filter((t) => t.id !== team.id)
          )
        }
        onSetActive={(user, team, active) => setTeamActive(user, team.id, active)}
        onSaved={loadTeams}
        onClose={() => setOpenTeamId(null)}
      />
    </div>
  );
}
