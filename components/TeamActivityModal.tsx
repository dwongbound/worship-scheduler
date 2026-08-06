"use client";
// Team Activity: an org-wide, filterable log of set activity — covers, swaps,
// approvals, admin add/remove/reassign, and self-service confirms — newest
// first. Opened from a button on the admin Team page.
import { useCallback, useEffect, useState } from "react";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import Select from "./common/Select";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { ALL_HISTORY_TYPES, HISTORY_TYPE_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import { describeSetHistoryEvent } from "@/lib/setHistory";
import type { ApiActivityEvent, ApiTeam } from "@/lib/types";

export default function TeamActivityModal({
  open,
  onClose,
  orgId,
  teams,
}: {
  open: boolean;
  onClose: () => void;
  orgId: string;
  teams: ApiTeam[];
}) {
  const [events, setEvents] = useState<ApiActivityEvent[] | null>(null);
  const [type, setType] = useState("");
  const [teamId, setTeamId] = useState("");

  const load = useCallback(async () => {
    setEvents(null);
    const qs = new URLSearchParams({ orgId });
    if (type) qs.set("type", type);
    if (teamId) qs.set("teamId", teamId);
    const data = await fetchJsonArray<ApiActivityEvent>(
      `/api/admin/activity?${qs}`,
      { headers: orgHeaders(orgId) }
    );
    setEvents(data);
  }, [orgId, type, teamId]);

  // (Re)load whenever the modal opens or a filter changes.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  return (
    <Modal open={open} onClose={onClose} title="Team Activity">
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-44">
          <Select label="Activity" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All activity</option>
            {ALL_HISTORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {HISTORY_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select label="Team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {!events ? (
        <div className="py-8 text-center">
          <LoadingDots />
        </div>
      ) : events.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
          No activity{type || teamId ? " for this filter" : ""} yet.
        </p>
      ) : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700/50">
          {events.map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </ul>
      )}
    </Modal>
  );
}

// One log row: which set + when on top, then who did what (reusing the same
// descriptor the per-set history uses).
function ActivityRow({ event }: { event: ApiActivityEvent }) {
  const { actor, tokens } = describeSetHistoryEvent(event);
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="text-xs text-gray-400 dark:text-gray-500">
        {formatDay(event.createdAt)} · {formatTime(event.createdAt)} ({actor}) ·{" "}
        {event.set.label ?? "Worship Set"}
        {event.teamName ? ` · ${event.teamName}` : ""}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-gray-600 dark:text-gray-400">
        {tokens.map((token, i) =>
          typeof token === "string" ? (
            <span key={i}>{token}</span>
          ) : (
            <span
              key={i}
              className={`inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300 ${
                token.struck ? "line-through opacity-60" : ""
              }`}
            >
              {token.name}
            </span>
          )
        )}
      </div>
    </li>
  );
}
