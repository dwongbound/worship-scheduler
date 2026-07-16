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
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Dropdown from "@/components/common/Dropdown";
import LoadingDots from "@/components/common/LoadingDots";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import { TEAMS_CHANGED_EVENT } from "@/components/Navbar";
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
  const [stats, setStats] = useState<Record<string, UserSetBreakdown[]> | null>(
    null
  );
  // True from the moment the admin org changes until users, teams AND stats
  // have all reloaded — keeps the full-page loader up so the switch happens as
  // one atomic swap instead of each section updating piecewise.
  const [switchingOrg, setSwitchingOrg] = useState(false);

  const myId = session?.user?.id;
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
      // A team-membership edit may have (un)covered someone — let the navbar
      // refresh its "not on a team" reminder dot/banner right away.
      if (patchTeams) window.dispatchEvent(new Event(TEAMS_CHANGED_EVENT));
    },
    [load, adminOrgId]
  );

  function toggleInstrument(user: ApiAdminUser, inst: Instrument) {
    const next = user.instruments.includes(inst)
      ? user.instruments.filter((i) => i !== inst)
      : [...user.instruments, inst];
    patchUser(user.id, { instruments: next });
  }

  // Add this person to a team from their card's "+ Add to team" chip. Goes
  // through patchUser so the card's chips update optimistically.
  function addToTeam(user: ApiAdminUser, team: ApiTeam) {
    if (user.teams.some((t) => t.id === team.id)) return;
    patchUser(user.id, { teams: [...user.teams, team] });
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

      {/* ── Teams: read-only list here; managed on the Org settings page ── */}
      <Card>
        {/* Styled as a heading but rendered as <p>: the e2e specs target the
            page's "Team" <h1> with a non-exact heading query, and any real
            heading containing "Team" would collide with it. */}
        <p className="mb-1 font-semibold">Teams</p>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          Every set belongs to a team, and only that team&rsquo;s members are
          scheduled on it. Team settings can only be modified on the{" "}
          <Link
            href="/orgs"
            className="font-medium text-indigo-600 underline dark:text-indigo-400"
          >
            Org settings page
          </Link>{" "}
          (desktop only).
        </p>
        {teams.length === 0 ? (
          <p className="text-sm text-gray-400">No teams yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {teams.map((team) => {
              const result = sendResult[team.id];
              return (
                <li
                  key={team.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2"
                >
                  <div>
                    <p className="text-sm font-medium">{team.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {memberCount(team.id)}{" "}
                      {memberCount(team.id) === 1 ? "member" : "members"}
                    </p>
                  </div>
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

                  {/* Membership chips, plus an inline "+ Add to team" chip in
                      the first free slot so an admin can add this person to any
                      team they're not already on without opening the team card. */}
                  {(() => {
                    const available = teams.filter(
                      (t) => !user.teams.some((ut) => ut.id === t.id)
                    );
                    return (
                      <div>
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Teams
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {user.teams.map((team) => (
                            <Badge key={team.id} tone="indigo">
                              {team.name}
                            </Badge>
                          ))}
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
                </div>

                <SetBreakdown breakdown={stats?.[user.id]} loading={stats === null} />
              </div>
            </Card>
          </li>
        ))}
      </ul>
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
