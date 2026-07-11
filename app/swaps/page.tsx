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
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
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
  // Navbar org switcher: "all" or one org — filters both sections. Rows show
  // an org chip while several orgs are mixed together.
  const { orgs, viewOrgId } = useOrgs();
  const showOrgChips = viewOrgId === "all" && (orgs?.length ?? 0) > 1;

  const reload = useCallback(async () => {
    // Both endpoints return arrays; fall back to [] on any error so a hiccup
    // shows an empty list instead of crashing on `.map`.
    const orgParam = viewOrgId === "all" ? "" : `?orgId=${viewOrgId}`;
    const [mineData, swapsData] = await Promise.all([
      fetchJsonArray<ApiMyAssignment>(`/api/assignments${orgParam}`),
      fetchJsonArray<ApiSwapRequest>(`/api/swaps${orgParam}`),
    ]);
    setMine(mineData);
    setOpenSwaps(swapsData);
    // Nudge the navbar to refresh its red dot.
    window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
  }, [viewOrgId]);

  useEffect(() => {
    reload();
    // Joining a new org (navbar "Add an org…") widens the "All orgs" view.
    window.addEventListener(ORGS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(ORGS_CHANGED_EVENT, reload);
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
            // id anchors the calendar's "Take this set →" link (#cover-<id>);
            // scroll-mt keeps it clear of the sticky navbar when jumped to.
            <li key={swap.id} id={`cover-${swap.id}`} className="scroll-mt-24">
              <Card className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {swap.set.label ?? "Worship Set"} —{" "}
                    {INSTRUMENT_LABELS[swap.role]}
                    {showOrgChips && swap.set.org && (
                      <OrgChip name={swap.set.org.name} />
                    )}
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
            {/* Plain link download: the browser sends session cookies along.
                Hidden on phones — no .ics export on narrow screens. */}
            <a href="/api/export" download className="hidden sm:block">
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
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {a.set.label ?? "Worship Set"} —{" "}
                    {INSTRUMENT_LABELS[a.role]}
                    {showOrgChips && a.set.org && (
                      <OrgChip name={a.set.org.name} />
                    )}
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

// Small pill naming a set's org — shown only in "All orgs" view when the
// user belongs to more than one.
function OrgChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
      {name}
    </span>
  );
}
