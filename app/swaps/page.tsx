"use client";
// Swaps tab:
//   1. My sets — confirm (individually or all at once) or request a swap.
//   2. Open swap requests from teammates who play my instrument(s) —
//      one click takes over their slot (which then needs MY confirmation).
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import ExportIcsButton from "@/components/ExportIcsButton";
import { usePageLoading } from "@/components/LoadingProvider";
import StatusBadge from "@/components/StatusBadge";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { fetchJsonArray } from "@/lib/api";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import type { ApiMyAssignment, ApiSwapRequest } from "@/lib/types";

export default function SwapsPage() {
  const [mine, setMine] = useState<ApiMyAssignment[] | null>(null);
  const [openSwaps, setOpenSwaps] = useState<ApiSwapRequest[] | null>(null);
  // Id of the row currently updating (shows inline dots), and a flag for the
  // bulk "confirm all" button — so a mutation never remounts the whole page.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);

  const reload = useCallback(async () => {
    // Both endpoints return arrays; fall back to [] on any error so a hiccup
    // shows an empty list instead of crashing on `.map`.
    const [mineData, swapsData] = await Promise.all([
      fetchJsonArray<ApiMyAssignment>("/api/assignments"),
      fetchJsonArray<ApiSwapRequest>("/api/swaps"),
    ]);
    setMine(mineData);
    setOpenSwaps(swapsData);
    // Nudge the navbar to refresh its red dot.
    window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // PATCH one of my assignments: confirm / requestSwap / cancelSwap. Only the
  // acted-on row shows a loading state (busyId); the page stays mounted.
  async function act(assignmentId: string, action: string) {
    setBusyId(assignmentId);
    try {
      await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  async function confirmAll() {
    setConfirmingAll(true);
    try {
      await fetch("/api/assignments/confirm-all", { method: "POST" });
      await reload();
    } finally {
      setConfirmingAll(false);
    }
  }

  async function takeSwap(assignmentId: string) {
    setBusyId(assignmentId);
    try {
      await fetch(`/api/swaps/${assignmentId}/take`, { method: "POST" });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  // Full-page loader only for the initial data load — never for mutations.
  usePageLoading(!mine || !openSwaps);
  if (!mine || !openSwaps) return null;

  const pendingCount = mine.filter((a) => a.status === "PENDING").length;

  return (
    <div className="space-y-8">
      {/* ── Cover requests I could take ─────────────────────────────── */}
      <section>
        <h2 className="mb-3 text-xl font-bold">Cover Requests</h2>
        {openSwaps.length === 0 && (
          <p className="text-gray-500">
            No open cover requests for your instruments.
          </p>
        )}
        <ul className="space-y-3">
          {openSwaps.map((swap) => (
            <li key={swap.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {swap.set.label ?? "Worship Set"} —{" "}
                    {INSTRUMENT_LABELS[swap.role]}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDay(swap.set.startsAt)} ·{" "}
                    {formatTime(swap.set.startsAt)} · requested by{" "}
                    {swap.user.name}
                  </p>
                </div>
                {busyId === swap.id ? (
                  <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                ) : (
                  <Button size="sm" onClick={() => takeSwap(swap.id)}>
                    Take this set
                  </Button>
                )}
              </Card>
            </li>
          ))}
        </ul>
      </section>
      {/* ── My sets ─────────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">My Sets</h1>
          <div className="flex items-center gap-2">
            {/* Plain link download: the browser sends session cookies along. */}
            <a href="/api/export" download>
              <Button variant="secondary">Export my sets (.ics)</Button>
            </a>
            {pendingCount > 0 && (
              <Button
                onClick={confirmAll}
                disabled={confirmingAll}
                aria-label="Confirm all pending"
              >
                {confirmingAll ? (
                  <LoadingDots size="sm" label="Confirming" />
                ) : (
                  `Confirm all pending (${pendingCount})`
                )}
              </Button>
            )}
          </div>
        </div>

        {mine.length === 0 && (
          <p className="text-gray-500">You're not on any upcoming sets.</p>
        )}
        <ul className="space-y-3">
          {mine.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">
                    {a.set.label ?? "Worship Set"} —{" "}
                    {INSTRUMENT_LABELS[a.role]}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDay(a.set.startsAt)} · {formatTime(a.set.startsAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                          Cancel cover request
                        </Button>
                      )}
                    </>
                  )}
                  {/* Per-set .ics download (this one set, with my role). */}
                  {a.status != "PENDING"  && a.status != "SWAP_REQUESTED" && <ExportIcsButton
                    href={`/api/export/${a.set.id}`}
                    label="Export this set (.ics)"
                    size="sm"
                  />
                  }
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
