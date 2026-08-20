"use client";
// Users tab (admins only): manage the ministry teams (each team button opens a
// modal for its members/Slack/delete; creating a team lives on the Org
// settings page, which this panel links out to), grant or revoke admin access,
// and set which instruments each person can be scheduled for. Each
// user card shows their team memberships as read-only chips. Edits save
// automatically (optimistic update + PATCH; revert to server state on
// failure).
//
// A master date-range selector at the top drives a per-person count of how
// many sets each member is on within that range (see STAT_RANGES).
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Dropdown from "@/components/common/Dropdown";
import InfoTooltip from "@/components/common/InfoTooltip";
import TeamActivityModal from "@/components/TeamActivityModal";
import LoadingDots from "@/components/common/LoadingDots";
import Toggle from "@/components/common/Toggle";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import SlackIcon from "@/components/common/SlackIcon";
import { usePageLoading } from "@/components/LoadingProvider";
import TeamMembersModal from "@/components/TeamMembersModal";
import { TEAMS_CHANGED_EVENT } from "@/components/Navbar";
import { useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import {
  ALL_INSTRUMENTS,
  INSTRUMENT_LABELS,
  type Instrument,
} from "@/lib/constants";
import { STAT_RANGES, rangeForDays } from "@/lib/stats";
import type { UserStats } from "@/app/api/admin/users/stats/route";
import type { ApiAdminUser, ApiTeam } from "@/lib/types";

// Fixed-width right column of a user card: how many sets they're on in the
// selected range, broken down by set type (e.g. "Sunday Worship (3)").
// Hidden on phones (along with the range selector) — the metrics don't fit.
function SetBreakdown({
  stats,
  loading,
}: {
  stats: UserStats | undefined;
  loading: boolean;
}) {
  const teams = stats?.teams ?? [];
  const total = teams.reduce((sum, b) => sum + b.count, 0);
  // Cover/swap activity lines — only shown when non-zero.
  const activity: { label: string; count: number }[] = stats
    ? [
        { label: "Covers requested", count: stats.coversRequested },
        { label: "Covers taken", count: stats.coversTaken },
        { label: "Swaps requested", count: stats.swapsRequested },
        { label: "Swaps taken", count: stats.swapsTaken },
      ].filter((a) => a.count > 0)
    : [];
  return (
    <div className="hidden sm:block sm:w-52 sm:flex-shrink-0 sm:border-l sm:border-gray-200 sm:pl-4 dark:sm:border-gray-700">
      <p className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Sets
        {!loading && <Badge tone="blue">{total}</Badge>}
      </p>
      {/* Fixed height + independent scroll so every card is the same height
          no matter how many teams / activity lines a person has. */}
      <div className="h-24 overflow-y-auto pr-1">
        {loading ? (
          <p className="text-sm text-gray-400">…</p>
        ) : total === 0 && activity.length === 0 ? (
          <p className="text-sm text-gray-400">None in range</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {/* Sets grouped by team. */}
            {teams.map((b) => (
              <li key={b.label} className="flex justify-between gap-2">
                <span className="text-gray-700 dark:text-gray-300">
                  {b.label}
                </span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
                  {b.count}
                </span>
              </li>
            ))}
            {/* Cover / swap activity (only the non-zero ones). */}
            {activity.map((a) => (
              <li
                key={a.label}
                className="flex justify-between gap-2 text-xs text-gray-500 dark:text-gray-400"
              >
                <span>{a.label}</span>
                <span className="tabular-nums">{a.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// Wrapped in Suspense (below) because useSearchParams() requires a boundary —
// without one the whole route bails out of prerendering at build time.
function UsersPageInner() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<ApiAdminUser[] | null>(null);
  // Ministry teams (read-only here — full management lives on the Org page).
  const [teams, setTeams] = useState<ApiTeam[] | null>(null);
  // "Send set reminder" per team: which is in-flight + its last result.
  const [sendingTeamId, setSendingTeamId] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  // Team management modal (same one Org settings uses): which team is open, the
  // "add member" query, the delete-confirm target, and a busy flag while a
  // delete request is in flight.
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  // The pending admin-rights change awaiting confirmation (null = no modal).
  const [adminConfirm, setAdminConfirm] = useState<{
    user: ApiAdminUser;
    next: boolean;
  } | null>(null);
  // The team whose roster + per-team roles the page is focused on ("all" = show
  // everyone, with role editing off since roles are per-team).
  const [teamFilter, setTeamFilter] = useState("all");
  // Per-person team selection: which team's roles each member card is showing
  // (userId → teamId). The top "Set all to" dropdown bulk-fills this for every
  // member on the chosen team; each card can then diverge on its own.
  const [teamByUser, setTeamByUser] = useState<Record<string, string>>({});
  // Team Activity log modal.
  const [activityOpen, setActivityOpen] = useState(false);
  // Inline Slack-member-id editor: which user's is open, its draft, and errors.
  const [editingSlackFor, setEditingSlackFor] = useState<string | null>(null);
  const [slackDraft, setSlackDraft] = useState("");
  const [slackSaving, setSlackSaving] = useState(false);
  const [slackError, setSlackError] = useState<string | null>(null);
  // Whether THIS org's Slack bot is installed. Manual member-id entry only makes
  // sense once it is (the id belongs to that workspace, and it's what we'd DM
  // through) — until then we hide the "Set Slack ID" affordance entirely.
  const [orgSlackConnected, setOrgSlackConnected] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [confirmingTeamId, setConfirmingTeamId] = useState<string | null>(null);
  const [teamBusy, setTeamBusy] = useState(false);

  // Team stats: which range is picked, the custom range's dates, and the
  // userId → set-count map fetched for the active range (null while loading).
  // Default to "Next 4 weeks" (fall back to the first preset if it's renamed).
  const [rangeIdx, setRangeIdx] = useState(() => {
    const i = STAT_RANGES.findIndex((r) => r.days === 28);
    return i === -1 ? 0 : i;
  });
  const [customStart, setCustomStart] = useState(() => toYmd(new Date()));
  const [customEnd, setCustomEnd] = useState(() =>
    toYmd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  );
  // userId → per-set-type breakdown for the active range (null while loading).
  const [stats, setStats] = useState<Record<string, UserStats> | null>(null);
  // True from the moment the admin org changes until users, teams AND stats
  // have all reloaded — keeps the full-page loader up so the switch happens as
  // one atomic swap instead of each section updating piecewise.
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const myId = session?.user?.id;
  // Super-admins are admins of every org through the env allowlist, so the
  // membership flag can't lock them out — they may toggle their own.
  const amSuperAdmin = !!session?.user?.isSuperAdmin;
  // This page shows exactly ONE org (the navbar switcher's admin selection) —
  // members, teams, and stats all scope to it, with zero cross-org leakage.
  const { adminOrgId, isAdminAny } = useOrgs();
  const isAdmin = isAdminAny;

  // Deep-link from the navbar's "not on a team" banner: `?user=<username>`
  // scrolls that person's card into view and rings it briefly (username keeps
  // the URL readable instead of exposing an opaque id). `handledHighlight`
  // remembers which one we've already acted on so re-renders don't re-scroll.
  const router = useRouter();
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get("user");
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const handledHighlight = useRef<string | null>(null);

  const load = useCallback(() => {
    if (!adminOrgId) return;
    fetchJsonArray<ApiAdminUser>("/api/admin/users", {
      headers: orgHeaders(adminOrgId),
    }).then(setUsers);
    fetchJsonArray<ApiTeam>(`/api/teams?orgId=${adminOrgId}`).then(setTeams);
  }, [adminOrgId]);

  // `load`'s identity only changes when adminOrgId does, so this effect fires
  // on an org switch (not on the in-place reloads that mutations trigger).
  // Blank every section and mark the switch in progress so the full-page loader
  // covers the swap; it lifts once everything below has reloaded.
  useEffect(() => {
    if (!isAdmin) return;
    setSwitchingOrg(true);
    setUsers(null);
    setTeams(null);
    setStats(null);
    load();
  }, [isAdmin, load]);

  // The switch is done only once all three data sets are back for the new org.
  useEffect(() => {
    if (switchingOrg && users && teams && stats) setSwitchingOrg(false);
  }, [switchingOrg, users, teams, stats]);

  // Track whether the selected org has Slack connected, to gate manual id entry.
  useEffect(() => {
    if (!adminOrgId) return;
    setOrgSlackConnected(false);
    fetch(`/api/slack/status?orgId=${adminOrgId}`)
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => setOrgSlackConnected(!!d.enabled))
      .catch(() => setOrgSlackConnected(false));
  }, [adminOrgId]);

  // Post one team's "this week's sets" to its Slack channel on demand. Full
  // team management (create/delete, members, channel id) lives on the Org page.
  async function sendReminder(teamId: string) {
    setSendingTeamId(teamId);
    try {
      const res = await fetch(`/api/teams/${teamId}/slack-summary`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      setSendResult((m) => ({
        ...m,
        [teamId]: res.ok
          ? { ok: true, text: "Sent!" }
          : { ok: false, text: data.error ?? "Could not send." },
      }));
    } finally {
      setSendingTeamId(null);
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

  // Act on `?user=<username>` once the matching card is in the DOM: scroll it
  // into view, ring it, and strip the param so a refresh/back doesn't re-fire.
  // Clearing the param resets `handledHighlight` so clicking the same person
  // again re-scrolls. The ring's own timeout lives in the effect below, keyed
  // on the ring state, so stripping the param here doesn't cut it short.
  useEffect(() => {
    if (!highlightParam) {
      handledHighlight.current = null;
      return;
    }
    if (!users) return;
    if (handledHighlight.current === highlightParam) return;
    // The URL keys on username; resolve it to the card's id for scroll + ring.
    const match = users.find((u) => u.username === highlightParam);
    if (!match) return; // not in this org
    handledHighlight.current = highlightParam;

    document
      .getElementById(`user-card-${match.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(match.id);
    router.replace("/users", { scroll: false });
  }, [highlightParam, users, router]);

  // Fade the highlight ring a few seconds after it lands.
  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), 4000);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  // Apply a change locally right away, then persist it. If the request fails,
  // reload from the server so the UI reflects the true state.
  const patchUser = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ApiAdminUser, "isAdmin" | "isMD" | "teams">>
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
      // A team-membership edit may have (un)covered someone — let the navbar
      // refresh its "not on a team" reminder dot/banner right away.
      if (patchTeams) window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
    },
    [load, adminOrgId]
  );

  // Set a member's roles ON A SPECIFIC TEAM (roles are per-team). Optimistic
  // local update, then PATCH teamRoles; reload on failure.
  const setTeamRoles = useCallback(
    async (user: ApiAdminUser, teamId: string, roles: Instrument[]) => {
      setUsers(
        (prev) =>
          prev?.map((u) =>
            u.id === user.id
              ? {
                  ...u,
                  teams: u.teams.map((t) =>
                    t.id === teamId ? { ...t, roles } : t
                  ),
                }
              : u
          ) ?? prev
      );
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({ teamRoles: [{ teamId, roles }] }),
      });
      if (!res.ok) load();
      // Picking a first role (un)covers the "needs roles" nudge for this person.
      window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
    },
    [load, adminOrgId]
  );

  // Flip whether someone is schedulable ON ONE TEAM. Inactive people keep the
  // membership + their roles: the auto-scheduler just skips them, and the
  // manual pick / swap lists flag them "(inactive)". Optimistic, like the roles.
  const setTeamActive = useCallback(
    async (user: ApiAdminUser, teamId: string, active: boolean) => {
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
        headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
        body: JSON.stringify({ teamActive: [{ teamId, active }] }),
      });
      if (!res.ok) load();
    },
    [load, adminOrgId]
  );

  function toggleTeamRole(user: ApiAdminUser, teamId: string, role: Instrument) {
    const current = user.teams.find((t) => t.id === teamId)?.roles ?? [];
    const next = current.includes(role)
      ? current.filter((r) => r !== role)
      : [...current, role];
    setTeamRoles(user, teamId, next);
  }

  // Open the inline Slack-id editor for a person, prefilled with their current
  // id (admins can set it for someone who won't run the Connect flow).
  function startSlackEdit(user: ApiAdminUser) {
    setEditingSlackFor(user.id);
    setSlackDraft(user.slackUserId ?? "");
    setSlackError(null);
  }

  // Save (or clear, when blank) a person's Slack member id for this org.
  async function saveSlackId(user: ApiAdminUser) {
    setSlackSaving(true);
    setSlackError(null);
    const value = slackDraft.trim() || null;
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...orgHeaders(adminOrgId) },
      body: JSON.stringify({ slackUserId: value }),
    });
    if (res.ok) {
      setUsers(
        (prev) =>
          prev?.map((u) =>
            u.id === user.id
              ? { ...u, slackUserId: value, slackConnected: value != null }
              : u
          ) ?? prev
      );
      setEditingSlackFor(null);
    } else {
      const data = await res.json().catch(() => ({}));
      setSlackError(data.error ?? "Could not save Slack ID");
    }
    setSlackSaving(false);
  }

  // Add this person to a team from their card's "+ Add to team" chip. Goes
  // through patchUser so the card's chips update optimistically. New members
  // start with no roles on the team.
  function addToTeam(user: ApiAdminUser, team: ApiTeam) {
    if (user.teams.some((t) => t.id === team.id)) return;
    patchUser(user.id, {
      teams: [
        ...user.teams,
        { id: team.id, name: team.name, roles: [], active: true },
      ],
    });
  }

  // Remove this person from a team via the "x" on their membership chip. Same
  // optimistic patchUser path as addToTeam, just the inverse team set.
  function removeFromTeam(user: ApiAdminUser, team: ApiTeam) {
    patchUser(user.id, {
      teams: user.teams.filter((t) => t.id !== team.id),
    });
  }

  // Delete a team from the management modal (the route derives the org from the
  // team resource, so no org header is needed). Refetch users + teams so the
  // cards and Teams list reflect the removed memberships, then close.
  async function deleteTeam(teamId: string) {
    setTeamBusy(true);
    try {
      await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      load();
      window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
      setConfirmingTeamId(null);
      setOpenTeamId(null);
    } finally {
      setTeamBusy(false);
    }
  }

  usePageLoading(
    status === "loading" ||
      (!!isAdmin && (switchingOrg || !users || !teams))
  );

  if (status === "loading") return null;
  // Non-admins never see the tab, but guard direct visits too.
  if (!isAdmin) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }
  if (!users || !teams) return null;

  // Which team a member card is showing roles for: their explicit pick, else
  // their first team so a card always opens on something.
  const teamForUser = (user: ApiAdminUser) =>
    teamByUser[user.id] ?? user.teams[0]?.id ?? "";

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
            Pick a team to see its members and set the roles each person plays on
            it (roles are per-team). Grant or revoke admin access here too.
            Changes save automatically.
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

      {/* Teams panel: the header's team picker drives which members show below
          (and whose per-team roles are editable — "All members" turns role
          editing off, since a role only means something on a specific team). The
          list below manages each team (click → members/Slack/delete modal). */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {/* Styled as a heading but rendered as <p>: the e2e specs target the
                page's "Team" <h1> with a non-exact heading query, and any real
                heading containing "Team" would collide with it. */}
            <p className="font-semibold">Teams</p>
            <InfoTooltip
              text="Every set belongs to a team, and only that team’s members are scheduled on it. Click a team below to manage its members and Slack channel; scheduled weekly reminders live on the Org settings page (desktop only)."
            />
            {/* All cover/swap/approval activity across the org, filterable. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setActivityOpen(true)}
            >
              Team Activity
            </Button>
            {/* Creating a team lives on the Org settings page
                (OrgTeamsManager); this panel only manages teams that already
                exist, so link out rather than duplicating that form here. */}
            <Link
              href="/orgs"
              className="text-sm font-medium text-indigo-700 hover:underline
                dark:text-indigo-300"
            >
              + Add team
            </Link>
          </div>
          <div className="w-full sm:w-64">
            <Select
              label="Set all to team"
              hideLabel
              data-testid="team-filter"
              value={teamFilter}
              onChange={(e) => {
                const v = e.target.value;
                setTeamFilter(v);
                // Bulk-set every member on the chosen team to it; "all" clears
                // each card's selection so nobody's roles are shown.
                if (v === "all") {
                  setTeamByUser({});
                } else {
                  const next: Record<string, string> = {};
                  for (const u of users ?? []) {
                    if (u.teams.some((t) => t.id === v)) next[u.id] = v;
                  }
                  setTeamByUser(next);
                }
              }}
            >
              <option value="all">Set all to a team…</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {teams.length === 0 ? (
          <p className="text-sm text-gray-400">
            No teams yet. Add one on the{" "}
            <Link
              href="/orgs"
              className="font-medium text-indigo-700 hover:underline
                dark:text-indigo-300"
            >
              Org settings
            </Link>{" "}
            page.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {teams.map((team) => {
              const result = sendResult[team.id];
              return (
                <li
                  key={team.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  {/* Clickable: opens the same team-management modal the Org
                      settings page uses (members + Slack + delete). */}
                  <button
                    type="button"
                    onClick={() => {
                      setOpenTeamId(team.id);
                      setMemberQuery("");
                      setConfirmingTeamId(null);
                    }}
                    className="-mx-1 rounded px-1 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <p className="text-sm font-medium text-indigo-700 hover:underline dark:text-indigo-300">
                      {team.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {memberCount(team.id)}{" "}
                      {memberCount(team.id) === 1 ? "member" : "members"}
                    </p>
                  </button>
                  <div className="flex items-center gap-2">
                    {result && (
                      <span
                        className={`text-xs font-medium ${
                          result.ok
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {result.text}
                      </span>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => sendReminder(team.id)}
                      disabled={sendingTeamId === team.id || !team.slackChannelId}
                      title={
                        team.slackChannelId
                          ? undefined
                          : "Add a Slack channel ID on the Org settings page first."
                      }
                    >
                      {sendingTeamId === team.id ? (
                        <LoadingDots size="sm" />
                      ) : (
                        "Send set reminder"
                      )}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ul className="space-y-3">
        {users.map((user) => (
          <li key={user.id} id={`user-card-${user.id}`} className="scroll-mt-24">
            <Card
              className={
                highlightedId === user.id
                  ? "ring-2 ring-indigo-500 transition-shadow dark:ring-indigo-400"
                  : "transition-shadow"
              }
            >
              {/* Left: identity + roles. Right: fixed-width set breakdown. */}
              <div className="flex flex-col gap-4 sm:flex-row">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{user.name}</span>
                    {/* Slack member id for THIS org — click to set/edit it by
                        hand (the fallback to the person's own Connect flow). */}
                    {editingSlackFor === user.id ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          value={slackDraft}
                          onChange={(e) => setSlackDraft(e.target.value)}
                          placeholder="Slack member ID (U…)"
                          aria-label={`Slack member ID for ${user.name}`}
                          autoFocus
                          className="w-44 rounded border border-gray-300 px-2 py-0.5 text-xs focus:border-indigo-500 focus:outline-none dark:border-gray-600 dark:bg-gray-800"
                        />
                        <Button size="sm" onClick={() => saveSlackId(user)} disabled={slackSaving}>
                          {slackSaving ? <LoadingDots size="sm" /> : "Save"}
                        </Button>
                        <button
                          type="button"
                          onClick={() => setEditingSlackFor(null)}
                          className="text-xs text-gray-500 hover:underline dark:text-gray-400"
                        >
                          Cancel
                        </button>
                        {slackError && (
                          <span className="text-xs text-red-600">{slackError}</span>
                        )}
                      </span>
                    ) : user.slackConnected ? (
                      // Editable only while the org's bot is installed;
                      // otherwise show the id as a plain read-only badge.
                      orgSlackConnected ? (
                        <button
                          type="button"
                          onClick={() => startSlackEdit(user)}
                          title="Edit Slack member ID"
                          className="inline-flex items-center gap-0.5 text-green-600 hover:opacity-80 dark:text-green-400"
                        >
                          <SlackIcon className="h-4 w-4 shrink-0" />
                          <span aria-hidden className="text-xs font-semibold">✓</span>
                        </button>
                      ) : (
                        <span
                          title="Slack member ID"
                          className="inline-flex items-center gap-0.5 text-green-600 dark:text-green-400"
                        >
                          <SlackIcon className="h-4 w-4 shrink-0" />
                          <span aria-hidden className="text-xs font-semibold">✓</span>
                        </span>
                      )
                    ) : orgSlackConnected ? (
                      <button
                        type="button"
                        onClick={() => startSlackEdit(user)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
                      >
                        <SlackIcon className="h-3.5 w-3.5" /> Set Slack ID
                      </button>
                    ) : (
                      // Org hasn't connected Slack yet — nothing to link to,
                      // so no manual-entry affordance is shown.
                      <></>
                    )}
                    {/* Admin access, as a chip in the same family as the
                        Slack + team ones: dotted "Make admin" when they aren't
                        one, filled amber with an ✕ once they are. Both
                        directions confirm first — it's a rights change, not a
                        toggle you want to fat-finger. */}
                    {user.isAdmin ? (
                      <span className="inline-flex items-center rounded-full bg-amber-100 py-0.5 pl-2.5 pr-1 text-xs font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                        Admin
                        {/* Your own rights stay put (lockout guard), so your
                            chip carries no ✕ unless you're a super-admin. */}
                        {(user.id !== myId || amSuperAdmin) && (
                          <button
                            type="button"
                            onClick={() =>
                              setAdminConfirm({ user, next: false })
                            }
                            aria-label={`Remove ${user.name}'s admin access`}
                            title="Remove admin access"
                            className="ml-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-amber-600 transition-colors hover:bg-amber-200 hover:text-amber-900 dark:text-amber-400 dark:hover:bg-amber-800 dark:hover:text-amber-100"
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
                        )}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAdminConfirm({ user, next: true })}
                        className="inline-flex items-center rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200"
                      >
                        Make admin
                      </button>
                    )}
                    {user.isMD && <Badge tone="blue">MD</Badge>}
                  </div>

                  {/* Team membership chips — they double as this card's team
                      PICKER: the highlighted chip is the team whose roles show
                      below. Plus an inline "+ Add to team" chip so an admin can
                      add this person to a team without opening the team card.
                      The top "Set all to" dropdown highlights one chip on every
                      card at once. */}
                  {(() => {
                    const selTeam = teamForUser(user);
                    const available = teams.filter(
                      (t) => !user.teams.some((ut) => ut.id === t.id)
                    );
                    return (
                      <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Teams
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {user.teams.map((team) => {
                            const selected = team.id === selTeam;
                            const inactive = team.active === false;
                            return (
                              <span
                                key={team.id}
                                // A chip is two controls in one pill (select +
                                // remove), so the pill is a span — nesting a
                                // button inside a button isn't valid HTML.
                                className={`inline-flex items-center rounded-full py-0.5 pl-2.5 pr-1 text-xs font-medium ring-1 ring-inset ring-transparent transition-all ${
                                  selected
                                    ? "bg-indigo-600 text-white dark:bg-indigo-500"
                                    : inactive
                                      ? "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:ring-gray-400 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600 dark:hover:ring-gray-400"
                                      : "bg-indigo-100 text-indigo-800 hover:bg-indigo-200 hover:ring-indigo-500 dark:bg-indigo-900/50 dark:text-indigo-300 dark:hover:bg-indigo-900 dark:hover:ring-indigo-400"
                                }`}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setTeamByUser((prev) => ({
                                      ...prev,
                                      [user.id]: team.id,
                                    }))
                                  }
                                  aria-pressed={selected}
                                  title={`Show ${user.name}'s roles on ${team.name}`}
                                  className={selected ? "" : "cursor-pointer"}
                                >
                                  {team.name}
                                  {inactive && " (inactive)"}
                                </button>
                                {/* Inline remove: takes this person off the team,
                                    optimistically (see removeFromTeam). */}
                                <button
                                  type="button"
                                  onClick={() => removeFromTeam(user, team)}
                                  aria-label={`Remove ${user.name} from ${team.name}`}
                                  title={`Remove from ${team.name}`}
                                  className={`ml-1 flex h-3.5 w-3.5 items-center justify-center rounded-full transition-colors ${
                                    selected
                                      ? "text-indigo-100 hover:bg-indigo-700 hover:text-white dark:hover:bg-indigo-600"
                                      : "text-gray-400 hover:bg-gray-200 hover:text-gray-800 dark:hover:bg-gray-600 dark:hover:text-gray-100"
                                  }`}
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
                            );
                          })}
                          {available.length > 0 && (
                            <Dropdown
                              align="left"
                              trigger={
                                <span className="inline-flex items-center rounded-full border border-dashed border-gray-300 px-2.5 py-0.5 text-xs font-medium text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200">
                                  + Add to team
                                </span>
                              }
                            >
                              {available.map((team) => (
                                <button
                                  key={team.id}
                                  // Named like the chip's remove control: every
                                  // card offers the same team names, so the bare
                                  // name isn't a unique handle on this control.
                                  aria-label={`Add ${user.name} to ${team.name}`}
                                  onClick={() => addToTeam(user, team)}
                                  className="block w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700"
                                >
                                  {team.name}
                                </button>
                              ))}
                            </Dropdown>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Roles are per-team: this section belongs to the chip
                      selected above, and says so in its heading. MD sits here
                      (not the header) since it's a scheduling attribute,
                      alongside the roles. */}
                  {(() => {
                    const selTeam = teamForUser(user);
                    const team = user.teams.find((t) => t.id === selTeam);
                    const active = !!team && team.active !== false;
                    return (
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-3">
                          {/* Active on the SELECTED team only, and the switch
                              for the whole section: off = never auto-scheduled
                              there (they're still pickable by hand, flagged
                              "(inactive)"), and the roles below grey out. */}
                          {team && (
                            <Toggle
                              label="Active"
                              hideLabel
                              title={
                                active
                                  ? `${user.name} is active on ${team.name}`
                                  : `${user.name} is inactive on ${team.name}`
                              }
                              checked={active}
                              onChange={(next) =>
                                setTeamActive(user, team.id, next)
                              }
                            />
                          )}
                          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {team ? `${team.name} roles` : "Team roles"}
                          </p>
                        </div>
                        {team ? (
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {ALL_INSTRUMENTS.map((inst) => (
                              <Checkbox
                                key={inst}
                                label={INSTRUMENT_LABELS[inst]}
                                // Kept checked but greyed while they're
                                // inactive — the roles come back untouched the
                                // moment the switch goes on again.
                                disabled={!active}
                                checked={team.roles.includes(inst)}
                                onChange={() =>
                                  toggleTeamRole(user, team.id, inst)
                                }
                              />
                            ))}
                            {/* Musical director — the person can be a set's MD.
                                It's stored per PERSON, not per team, but it
                                belongs with the roles: it's the same "what can
                                they do on a set" question, and it greys out
                                with them. */}
                            <Checkbox
                              label="MD"
                              disabled={!active}
                              checked={user.isMD}
                              onChange={(e) =>
                                patchUser(user.id, { isMD: e.target.checked })
                              }
                            />
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                              Add {user.name.split(" ")[0]} to a team first.
                            </p>
                            <Checkbox
                              label="MD"
                              checked={user.isMD}
                              onChange={(e) =>
                                patchUser(user.id, { isMD: e.target.checked })
                              }
                            />
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <SetBreakdown stats={stats?.[user.id]} loading={stats === null} />
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {/* Team-management modal — the same shared component the Org settings
          page drives. Add/remove members go through patchUser so the user
          cards + member counts update optimistically. */}
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
        onDelete={deleteTeam}
        onAdd={(user, team) => {
          if (user.teams.some((t) => t.id === team.id)) return;
          patchUser(user.id, {
            teams: [
        ...user.teams,
        { id: team.id, name: team.name, roles: [], active: true },
      ],
          });
          setMemberQuery(""); // clear so they can type the next name
        }}
        onRemove={(user, team) =>
          patchUser(user.id, {
            teams: user.teams.filter((t) => t.id !== team.id),
          })
        }
        onSetActive={(user, team, active) =>
          setTeamActive(user, team.id, active)
        }
        onSaved={load}
        onClose={() => setOpenTeamId(null)}
      />

      {/* Granting/revoking admin rights — confirmed, never a bare toggle. */}
      {adminConfirm && (
        <Modal
          open
          onClose={() => setAdminConfirm(null)}
          title={adminConfirm.next ? "Make admin?" : "Remove admin access?"}
          footer={
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAdminConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={adminConfirm.next ? "primary" : "danger"}
                onClick={() => {
                  patchUser(adminConfirm.user.id, { isAdmin: adminConfirm.next });
                  setAdminConfirm(null);
                }}
              >
                {adminConfirm.next ? "Make admin" : "Remove access"}
              </Button>
            </>
          }
        >
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {adminConfirm.next ? (
              <>
                Give <span className="font-medium">{adminConfirm.user.name}</span>{" "}
                admin access to this org? They&rsquo;ll be able to manage sets,
                teams, and everyone&rsquo;s roles — including granting admin to
                others.
              </>
            ) : (
              <>
                Remove <span className="font-medium">{adminConfirm.user.name}</span>
                &rsquo;s admin access to this org? They stay a member and keep
                their teams and roles.
              </>
            )}
          </p>
        </Modal>
      )}

      <TeamActivityModal
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        orgId={adminOrgId}
        teams={teams}
      />
    </div>
  );
}

export default function UsersPage() {
  return (
    <Suspense fallback={null}>
      <UsersPageInner />
    </Suspense>
  );
}
