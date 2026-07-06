"use client";
// Users tab (admins only): grant/revoke admin access and set which
// instruments each person can be scheduled for. Edits save automatically
// (optimistic update + PATCH; revert to server state on failure).
//
// A master date-range selector at the top drives a per-person count of how
// many sets each member is on within that range (see STAT_RANGES).
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Badge from "@/components/common/Badge";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import Input from "@/components/common/Input";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import { fetchJsonArray } from "@/lib/api";
import {
  INSTRUMENT_LABELS,
  ROLE_ORDER,
  type Instrument,
} from "@/lib/constants";
import { STAT_RANGES, rangeForDays } from "@/lib/stats";
import type { UserSetBreakdown } from "@/app/api/admin/users/stats/route";
import type { ApiAdminUser } from "@/lib/types";

// yyyy-mm-dd (local) for seeding the custom <input type="date"> fields.
function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

// Fixed-width right column of a user card: how many sets they're on in the
// selected range, broken down by set type (e.g. "Sunday Worship (3)").
function SetBreakdown({
  breakdown,
  loading,
}: {
  breakdown: UserSetBreakdown[] | undefined;
  loading: boolean;
}) {
  const total = breakdown?.reduce((sum, b) => sum + b.count, 0) ?? 0;
  return (
    <div className="sm:w-52 sm:flex-shrink-0 sm:border-l sm:border-gray-200 sm:pl-4 dark:sm:border-gray-700">
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

  // Team stats: which range is picked, the custom range's dates, and the
  // userId → set-count map fetched for the active range (null while loading).
  const [rangeIdx, setRangeIdx] = useState(0);
  const [customStart, setCustomStart] = useState(() => toDateInput(new Date()));
  const [customEnd, setCustomEnd] = useState(() =>
    toDateInput(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
  );
  // userId → per-set-type breakdown for the active range (null while loading).
  const [stats, setStats] = useState<Record<string, UserSetBreakdown[]> | null>(
    null
  );

  const myId = session?.user?.id;
  const isAdmin = session?.user?.isAdmin;

  const load = useCallback(() => {
    fetchJsonArray<ApiAdminUser>("/api/admin/users").then(setUsers);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

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

  // (Re)fetch the set breakdown whenever the active range changes.
  useEffect(() => {
    if (!isAdmin || !startISO || !endISO) return;
    let active = true;
    setStats(null);
    const params = new URLSearchParams({ start: startISO, end: endISO });
    fetch(`/api/admin/users/stats?${params}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => active && setStats(data))
      .catch(() => active && setStats({}));
    return () => {
      active = false;
    };
  }, [isAdmin, startISO, endISO]);

  // Apply a change locally right away, then persist it. If the request fails,
  // reload from the server so the UI reflects the true state.
  const patchUser = useCallback(
    async (
      id: string,
      patch: Partial<Pick<ApiAdminUser, "isAdmin" | "instruments">>
    ) => {
      setUsers(
        (prev) => prev?.map((u) => (u.id === id ? { ...u, ...patch } : u)) ?? prev
      );
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) load();
    },
    [load]
  );

  function toggleInstrument(user: ApiAdminUser, inst: Instrument) {
    const next = user.instruments.includes(inst)
      ? user.instruments.filter((i) => i !== inst)
      : [...user.instruments, inst];
    patchUser(user.id, { instruments: next });
  }

  usePageLoading(status === "loading" || (!!isAdmin && !users));

  if (status === "loading") return null;
  // Non-admins never see the tab, but guard direct visits too.
  if (!isAdmin) {
    return <p className="text-gray-500">You need admin access for this page.</p>;
  }
  if (!users) return null;

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

        <div className="flex flex-col gap-2 sm:w-64 sm:flex-shrink-0">
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
              <Input
                label="From"
                type="date"
                value={customStart}
                max={customEnd || undefined}
                onChange={(e) => setCustomStart(e.target.value)}
              />
              <Input
                label="To"
                type="date"
                value={customEnd}
                min={customStart || undefined}
                onChange={(e) => setCustomEnd(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

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
                    </div>
                    {/* Can't change your own admin flag (avoids lockout). */}
                    <Checkbox
                      label={
                        user.id === myId ? "Admin access (you)" : "Admin access"
                      }
                      checked={user.isAdmin}
                      disabled={user.id === myId}
                      onChange={(e) =>
                        patchUser(user.id, { isAdmin: e.target.checked })
                      }
                    />
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
