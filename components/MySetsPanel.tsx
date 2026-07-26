"use client";
// The "Upcoming sets" card: lists upcoming sets, soonest first. By default it
// shows EVERY upcoming set (in view); the "Show" filter narrows it to just the
// sets I'm on. Sets I'm on carry the same confirm / request-swap actions as the
// Set Manager tab; sets I'm not on are just clickable (open the roster modal).
//   - Desktop (a `width` is given): a fixed-width, sticky sidebar the page
//     resizes via the draggable divider (PanelDivider) to its left.
//   - Mobile (no `width`): the whole Calendar tab on phones — its own heading +
//     controls, then one standalone card per set (no wrapper panel).
import { useMemo, useState } from "react";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import Select from "./common/Select";
import StatusBadge from "./StatusBadge";
import { SWAPS_CHANGED_EVENT } from "./Navbar";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import { selectUpcomingSets } from "@/lib/sets";
import type { ApiSet } from "@/lib/types";

export default function MySetsPanel({
  width,
  sets,
  myId,
  onSelectSet,
  onChanged,
}: {
  // Sidebar width in px. Omit for a full-width, non-sticky mobile card.
  width?: number;
  sets: ApiSet[];
  myId?: string;
  onSelectSet: (set: ApiSet) => void;
  onChanged: () => void | Promise<void>;
}) {
  // Id of the assignment currently updating — only that row shows dots.
  const [busyId, setBusyId] = useState<string | null>(null);
  // Sort order: soonest upcoming first (default), or float sets I still need
  // to confirm to the top.
  const [sortBy, setSortBy] = useState<"date" | "unconfirmed">("date");
  // Which sets to show: every upcoming set (default) or only the ones I'm on.
  const [scope, setScope] = useState<"all" | "mine">("all");

  // Upcoming sets (each paired with every role I play on it — a person can hold
  // more than one, or none when it isn't my set), in the chosen sort order.
  // The selection rule is a pure, unit-tested helper (see lib/sets.ts).
  const upcomingSets = useMemo(
    () => selectUpcomingSets(sets, myId, { scope, sortBy }),
    [sets, myId, sortBy, scope]
  );

  // PATCH my assignment: confirm / requestSwap / cancelSwap, then refresh.
  async function act(assignmentId: string, action: string) {
    setBusyId(assignmentId);
    try {
      await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await onChanged();
      window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
    } finally {
      setBusyId(null);
    }
  }

  // With a width we're the desktop sidebar (fixed width, sticky so it stays
  // put while the taller calendar scrolls); without one we're the mobile view:
  // no wrapper card, just the page heading + one standalone card per set.
  const asSidebar = width !== undefined;

  // Compact controls, shared by both layouts (labels are sr-only): a scope
  // filter (all upcoming vs. just mine) and a sort order.
  const controls = (
    <div className="flex items-center gap-2">
      <div className="w-32">
        <Select
          label="Show sets"
          hideLabel
          value={scope}
          onChange={(e) => setScope(e.target.value as "all" | "mine")}
        >
          <option value="all">All sets</option>
          <option value="mine">My sets</option>
        </Select>
      </div>
      <div className="w-40">
        <Select
          label="Sort sets"
          hideLabel
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as "date" | "unconfirmed")}
        >
          <option value="date">Soonest first</option>
          <option value="unconfirmed">Unconfirmed first</option>
        </Select>
      </div>
    </div>
  );

  const list =
    upcomingSets.length === 0 ? (
      <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
        {scope === "mine"
          ? "You’re not on any upcoming sets."
          : "No upcoming sets."}
      </p>
    ) : (
      <ul className={asSidebar ? "space-y-2" : "space-y-3"}>
        {upcomingSets.map(({ set, mine }) => (
          <li
            key={set.id}
            className={
              asSidebar
                ? "rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                // Mobile: each set is its own card (no shared wrapper panel).
                : "rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            }
          >
            <button
              onClick={() => onSelectSet(set)}
              className="w-full text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-gray-900 dark:text-gray-100">
                  {set.label ?? "Worship Set"}
                </p>
                {/* Mobile: just the status chip inline with the title — no role
                    label or action buttons. Tap the card to confirm / request
                    cover in the detail modal instead. */}
                {!asSidebar &&
                  mine.map((a) => <StatusBadge key={a.id} status={a.status} />)}
              </div>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
              </p>
            </button>

            {/* Desktop sidebar: one full action row per role I play on this
                set (role pill, status, confirm / request-cover buttons). */}
            {asSidebar &&
              mine.map((a) => (
              <div
                key={a.id}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                  {INSTRUMENT_LABELS[a.role]}
                </span>
                <StatusBadge status={a.status} />
                {busyId === a.id ? (
                  <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <>
                    {a.status === "PENDING" && (
                      <Button size="sm" onClick={() => act(a.id, "confirm")}>
                        Confirm
                      </Button>
                    )}
                    {a.status !== "SWAP_REQUESTED" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => act(a.id, "requestSwap")}
                      >
                        Request cover
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => act(a.id, "cancelSwap")}
                      >
                        Cancel cover
                      </Button>
                    )}
                  </>
                )}
              </div>
            ))}
          </li>
        ))}
      </ul>
    );

  // Mobile: page heading + controls, then the bare list of set cards.
  if (!asSidebar) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Upcoming sets</h1>
          {controls}
        </div>
        {list}
      </div>
    );
  }

  // Desktop sidebar: the sticky wrapper card with its own header.
  return (
    <div className="shrink-0" style={{ width }}>
      <aside className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Upcoming sets
          </h2>
          {controls}
        </div>

        <div className="flex-1 overflow-y-auto p-3">{list}</div>
      </aside>
    </div>
  );
}
