"use client";
// Users tab (admins only): manage the ministry teams (add/delete a team, and
// manage its members through each team button's modal), grant or revoke admin
// access, and set which instruments each person can be scheduled for. Each
// user card shows their team memberships as read-only chips. Edits save
// automatically (optimistic update + PATCH; revert to server state on
// failure).
//
// A master date-range selector at the top drives a per-person count of how
// many sets each member is on within that range (see STAT_RANGES).
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Input from "@/components/common/Input";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import { useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";
import { STAT_RANGES, rangeForDays } from "@/lib/stats";
import type { UserSetBreakdown } from "@/app/api/admin/users/stats/route";
import type { ApiAdminUser, ApiTeam } from "@/lib/types";

// Fixed-width right column of a user card: how many sets they're on in the
// selected range, broken down by set type (e.g. "Sunday Worship (3)").
// Hidden on phones (along with the range selector) — the metrics don't fit.
function SetBreakdown({
  breakdown,
  loading,
}: {
  breakdown: UserSetBreakdown[] | undefined;
  loading: boolean;
}) {
  const total = breakdown?.reduce((sum, b) => sum + b.count, 0) ?? 0;
  return (
    <div className="hidden sm:block sm:w-52 sm:flex-shrink-0 sm:border-l sm:border-gray-200 sm:pl-4 dark:sm:border-gray-700">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Sets
        {!loading && <Badge tone="blue">{total}</Badge>}
      </p>
      {/* Fixed height + independent scroll so every card is the same height
          no matter how many set types a person has. */}
      <div className="h-24 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-sm text-gray-400">…</p>
        ) : total === 0 ? (
          <p className="text-sm text-gray-400">None in range</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {breakdown!.map((b) => (
              <li key={b.label} className="flex justify-between gap-2">
                <span className="text-gray-700 dark:text-gray-300">
                  {b.label}
                </span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {b.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  // Ministry teams (managed in the card at the top of the page).
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  const [newTeamName, setNewTeamName] = useState("");
  // Whether the "+ Add team" chip has been swapped for its inline name input.
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);
  // Team whose delete button was clicked once (two-step confirm).
  const [confirmingTeamId, setConfirmingTeamId] = useState<string | null>(null);
  // Team whose members modal is open, + the add-member autocomplete query.
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");

  // Team stats: which range is picked, the custom range's dates, and the
  // userId → set-count map fetched for the active range (null while loading).
  const [rangeIdx, setRangeIdx] = useState(0);
  const [customStart, setCustomStart] = useState(() => toYmd(new Date()));
  const [customEnd, setCustomEnd] = useState(() =>
    toYmd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  );
  // userId → per-set-type breakdown for the active range (null while loading).
  const [stats, setStats] = useState<Record<string, UserSetBreakdown[]> | null>(
    null
  );

  const myId = session?.user?.id;
  // This page shows exactly ONE org (the navbar switcher's admin selection) —
  // members, teams, and stats all scope to it, with zero cross-org leakage.
  const { adminOrgId, isAdminAny } = useOrgs();
  const isAdmin = isAdminAny;

  const load = useCallback(() => {
    if (!adminOrgId) return;
    fetchJsonArray<ApiAdminUser>("/api/admin/users", {
      headers: orgHeaders(adminOrgId),
    }).then(setUsers);
    fetchJsonArray<ApiTeam>(`/api/teams?orgId=${adminOrgId}`).then(setTeams);
  }, [adminOrgId]);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  // ── Team management (the card at the top) ─────────────────────────────
  async function addTeam() {
    const name = newTeamName.trim();
    if (!name) return;
    setTeamBusy(true);
    setTeamError("");
    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTeamError(data.error ?? "Could not add the team.");
        return;
      }
      setNewTeamName("");
      setAddingTeam(false); // collapse the inline input back to the "+" chip
      load();
    } finally {
      setTeamBusy(false);
    }
  }

  // Deleting a team keeps its sets (they become team-less = open to everyone)
  // and simply drops the memberships — hence the inline two-step confirm.
  async function deleteTeam(id: string) {
    setConfirmingTeamId(null);
    setTeamBusy(true);
    setTeamError("");
    try {
      const res = await fetch(`/api/teams/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setTeamError(data.error ?? "Could not delete the team.");
      }
      load();
    } finally {
      setTeamBusy(false);
    }
  }

  // Resolve the selected range to concrete [start, end] ISO strings. Presets
  // are relative to now; "Custom range…" (days === null) uses the date inputs,
  // widened to cover the whole end day so it reads inclusively.
  const selected = STAT_RANGES[rangeIdx];
  const isCustom = selected.days === null;
  const { startISO, endISO } = useMemo(() => {
    if (selected.days !== null) {
      const { start, end } = rangeForDays(selected.days);
      return { startISO: start.toISOString(), endISO: end.toISOString() };
    }
    return {
      startISO: customStart ? `${customStart}T00:00:00` : "",
      endISO: customEnd ? `${customEnd}T23:59:59.999` : "",
    };
  }, [selected, customStart, customEnd]);

  // (Re)fetch the set breakdown whenever the active range or org changes.
  useEffect(() => {
    if (!isAdmin || !adminOrgId || !startISO || !endISO) return;
    let active = true;
    setStats(null);
    const params = new URLSearchParams({ start: startISO, end: endISO });
    fetch(`/api/admin/users/stats?${params}`, {
      headers: orgHeaders(adminOrgId),
    })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => active && setStats(data))
      .catch(() => active && setStats({}));
    return () => {
      active = false;
    };
  }, [isAdmin, adminOrgId, startISO, endISO]);

  // Apply a change locally right away, then persist it. If the request fails,
  // reload from the server so the UI reflects the true state.
  const patchUser = useCallback(
    async (
      id: string,
      patch: Partial<
        Pick<ApiAdminUser, "isAdmin" | "isMD" | "instruments" | "teams">
      >
    ) => {
      setUsers(
        (prev) => prev?.map((u) => (u.id === id ? { ...u, ...patch } : u)) ?? prev
      );
      // The API takes team ids, not the {id, name} objects the UI holds.
      const { teams: patchTeams, ...rest } = patch;
      const body = patchTeams
        ? { ...rest, teamIds: patchTeams.map((t) => t.id) }
        : rest;
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        // The org header scopes the edit: isAdmin toggles THIS org's
        // membership flag, team ids must belong to this org.
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify(body),
      });
      if (!res.ok) load();
    },
    [load, adminOrgId]
  );

  function toggleInstrument(user: ApiAdminUser, inst: Instrument) {
    const next = user.instruments.includes(inst)
      ? user.instruments.filter((i) => i !== inst)
      : [...user.instruments, inst];
    patchUser(user.id, { instruments: next });
  }

  // Membership edits from the team members modal. Both go through patchUser,
  // so the user cards' chips update optimistically with the same state.
  function addToTeam(user: ApiAdminUser, team: ApiTeam) {
    if (user.teams.some((t) => t.id === team.id)) return;
    patchUser(user.id, { teams: [...user.teams, team] });
  }

  function removeFromTeam(user: ApiAdminUser, team: ApiTeam) {
    patchUser(user.id, {
      teams: user.teams.filter((t) => t.id !== team.id),
    });
  }

  usePageLoading(status === "loading" || (!!isAdmin && (!users || !teams)));

  if (status === "loading") return null;
  // Non-admins never see the tab, but guard direct visits too.
  if (!isAdmin) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }
  if (!users || !teams) return null;

  // Member count per team, for the pills in the Teams card.
  const memberCount = (teamId: string) =>
    users.filter((u) => u.teams.some((t) => t.id === teamId)).length;

  return (
    <div className="space-y-6">
      {/* Title + subtext on the left; the master range selector (which drives
          each person's set breakdown) sits at the top-right. */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Team</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Grant or revoke admin access and set which instruments each person
            can be scheduled for. Changes save automatically.
          </p>
        </div>

        {/* Hidden on phones: it only drives the per-person set counts, which
            the phone layout doesn't show (see SetBreakdown). */}
        <div className="hidden flex-col gap-2 sm:flex sm:w-64 sm:flex-shrink-0">
          <Select
            label="Show set counts for"
            value={rangeIdx}
            onChange={(e) => setRangeIdx(Number(e.target.value))}
          >
            {STAT_RANGES.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </Select>
          {isCustom && (
            <div className="grid grid-cols-2 gap-2">
              <DateSelect
                label="From"
                value={customStart}
                max={customEnd || undefined}
                onChange={setCustomStart}
              />
              <DateSelect
                label="To"
                value={customEnd}
                min={customStart || undefined}
                onChange={setCustomEnd}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Teams: add/delete the ministry teams sets are scheduled for ── */}
      <Card>
        {/* Styled as a heading but rendered as <p>: the e2e specs target the
            page's "Team" <h1> with a non-exact heading query, and any real
            heading containing "Team" would collide with it. */}
        <p className="mb-1 font-semibold">Teams</p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Every set belongs to a team, and only that team&rsquo;s members are
          scheduled on it. Click a team to see and manage its members.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Each team is a chip: click to open its members modal (view,
              add, remove members, delete the team). */}
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => {
                setOpenTeamId(team.id);
                setMemberQuery("");
                setConfirmingTeamId(null);
              }}
              className="flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm
                transition-colors hover:bg-indigo-100 dark:bg-gray-800 dark:hover:bg-indigo-900/40"
            >
              <span className="font-medium">{team.name}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {memberCount(team.id)}{" "}
                {memberCount(team.id) === 1 ? "member" : "members"}
              </span>
            </button>
          ))}

          {/* Adding a team is a clear (dashed) chip: clicking it swaps in an
              inline name input; Enter/Add saves, Escape cancels. */}
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
      </Card>

      <ul className="space-y-3">
        {users.map((user) => (
          <li key={user.id}>
            <Card>
              {/* Left: identity + roles. Right: fixed-width set breakdown. */}
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{user.name}</span>
                      {user.isAdmin && <Badge tone="amber">Admin</Badge>}
                      {user.isMD && <Badge tone="blue">MD</Badge>}
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Musical director: eligible to be a required-MD set's MD. */}
                      <Checkbox
                        label="MD"
                        checked={user.isMD}
                        onChange={(e) =>
                          patchUser(user.id, { isMD: e.target.checked })
                        }
                      />
                      {/* Can't change your own admin flag (avoids lockout). */}
                      <Checkbox
                        label={
                          user.id === myId
                            ? "Admin access (you)"
                            : "Admin access"
                        }
                        checked={user.isAdmin}
                        disabled={user.id === myId}
                        onChange={(e) =>
                          patchUser(user.id, { isAdmin: e.target.checked })
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Instruments / roles
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {ROLE_ORDER.map((inst) => (
                        <Checkbox
                          key={inst}
                          label={INSTRUMENT_LABELS[inst]}
                          checked={user.instruments.includes(inst)}
                          onChange={() => toggleInstrument(user, inst)}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Read-only membership chips — manage membership from the
                      team buttons in the Teams card above. */}
                  {user.teams.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        Teams
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {user.teams.map((team) => (
                          <Badge key={team.id} tone="blue">
                            {team.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <SetBreakdown breakdown={stats?.[user.id]} loading={stats === null} />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      <TeamMembersModal
        team={teams.find((t) => t.id === openTeamId) ?? null}
        users={users}
        query={memberQuery}
        onQueryChange={setMemberQuery}
        busy={teamBusy}
        confirmingDelete={confirmingTeamId === openTeamId}
        onConfirmDelete={(confirming) =>
          setConfirmingTeamId(confirming ? openTeamId : null)
        }
        onDelete={(id) => {
          setOpenTeamId(null);
          deleteTeam(id);
        }}
        onAdd={addToTeam}
        onRemove={removeFromTeam}
        onSaved={load}
        onClose={() => setOpenTeamId(null)}
      />
    </div>
  );
}

// Members modal for one team: the current roster (with per-person remove), an
// autocomplete input to add people, the team's Slack channel + weekly-summary
// send button, and the team's delete button.
function TeamMembersModal({
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
  useEffect(() => {
    setChannelId(team?.slackChannelId ?? "");
    setSlackMsg(null);
  }, [team?.id, team?.slackChannelId]);

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
            disabled={slackBusy || !team.slackChannelId}
          >
            Send this week&rsquo;s sets
          </Button>
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
