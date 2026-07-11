"use client";
// The "My sets" card: lists the sets I'm on, upcoming first, with the same
// confirm / request-swap actions as the Set Manager tab.
//   - Desktop (a `width` is given): a fixed-width, sticky sidebar the page
//     resizes via the draggable divider (PanelDivider) to its left.
//   - Mobile (no `width`): the whole Calendar tab on phones — its own "My
//     sets" heading + sort control, then one standalone card per set (no
//     wrapper panel).
import { useMemo, useState } from "react";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import Select from "./common/Select";
import StatusBadge from "./StatusBadge";
import { SWAPS_CHANGED_EVENT } from "./Navbar";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
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

  // My upcoming sets (each paired with every role I play on it — a person can
  // hold more than one), in the chosen sort order.
  const mySets = useMemo(() => {
    if (!myId) return [];
    const now = Date.now();
    const rows = sets
      .map((set) => ({
        set,
        mine: set.assignments.filter((a) => a.user.id === myId),
      }))
      .filter(
        (row) => row.mine.length > 0 && new Date(row.set.startsAt).getTime() >= now
      )
      .sort((a, b) => a.set.startsAt.localeCompare(b.set.startsAt));
    if (sortBy === "unconfirmed") {
      // Stable partition: sets where I still owe a confirmation first, keeping
      // the soonest-first order within each group.
      const pending = (row: (typeof rows)[number]) =>
        row.mine.some((a) => a.status === "PENDING");
      rows.sort((a, b) => Number(pending(b)) - Number(pending(a)));
    }
    return rows;
  }, [sets, myId, sortBy]);

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

  // Compact sort control, shared by both layouts (label is sr-only).
  const sortSelect = (
    <div className="w-44">
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
  );

  const list =
    mySets.length === 0 ? (
      <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
        You&rsquo;re not on any upcoming sets.
      </p>
    ) : (
      <ul className={asSidebar ? "space-y-2" : "space-y-3"}>
        {mySets.map(({ set, mine }) => (
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
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {set.label ?? "Worship Set"}
              </p>
              <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {formatDay(set.startsAt)} · {formatTime(set.startsAt)}
              </p>
            </button>

            {/* One action row per role I play on this set. */}
            {mine.map((a) => (
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

  // Mobile: page heading + sort control, then the bare list of set cards.
  if (!asSidebar) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">My sets</h1>
          {sortSelect}
        </div>
        {list}
      </div>
    );
  }

  // Desktop sidebar: the sticky wrapper card with its own header.
  return (
    <div className="shrink-0" style={{ width }}>
      <aside className="sticky top-20 flex max-h-[calc(100vh-6rem)] flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            My sets
          </h2>
          {sortSelect}
        </div>

        <div className="flex-1 overflow-y-auto p-3">{list}</div>
      </aside>
    </div>
  );
}
