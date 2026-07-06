"use client";
// The "My sets" card: lists the sets I'm on, upcoming first, with the same
// confirm / request-swap actions as the Set Manager tab.
//   - Desktop (a `width` is given): a fixed-width, sticky sidebar the page
//     resizes via the draggable divider (PanelDivider) to its left.
//   - Mobile (no `width`): a plain full-width card — on phones the calendar
//     grid is hidden and this list is the whole Calendar tab.
import { useMemo, useState } from "react";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
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

  // My upcoming sets, soonest first (each paired with the role I play).
  const mySets = useMemo(() => {
    if (!myId) return [];
    const now = Date.now();
    return sets
      .map((set) => ({
        set,
        mine: set.assignments.find((a) => a.user.id === myId),
      }))
      .filter((row) => row.mine && new Date(row.set.startsAt).getTime() >= now)
      .sort((a, b) => a.set.startsAt.localeCompare(b.set.startsAt));
  }, [sets, myId]);

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
  // put while the taller calendar scrolls); without one we're the full-width
  // mobile card.
  const asSidebar = width !== undefined;

  return (
    <div className={asSidebar ? "shrink-0" : ""} style={asSidebar ? { width } : undefined}>
      <aside
        className={`flex flex-col rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800 ${
          asSidebar ? "sticky top-20 max-h-[calc(100vh-6rem)]" : ""
        }`}
      >
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            My sets
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {mySets.length === 0 ? (
            <p className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">
              You&rsquo;re not on any upcoming sets.
            </p>
          ) : (
            <ul className="space-y-2">
              {mySets.map(({ set, mine }) => (
                <li
                  key={set.id}
                  className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
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

                  {mine && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                        {INSTRUMENT_LABELS[mine.role]}
                      </span>
                      <StatusBadge status={mine.status} />
                      {busyId === mine.id ? (
                        <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                      ) : (
                        <>
                          {mine.status === "PENDING" && (
                            <Button
                              size="sm"
                              onClick={() => act(mine.id, "confirm")}
                            >
                              Confirm
                            </Button>
                          )}
                          {mine.status !== "SWAP_REQUESTED" ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => act(mine.id, "requestSwap")}
                            >
                              Request cover
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => act(mine.id, "cancelSwap")}
                            >
                              Cancel cover
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
