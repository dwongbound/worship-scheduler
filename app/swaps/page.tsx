"use client";
// Swaps tab:
//   1. My sets — confirm (individually or all at once) or request a swap.
//   2. Open swap requests from teammates who play my instrument(s) —
//      one click takes over their slot (which then needs MY confirmation).
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import ExportIcsButton from "@/components/ExportIcsButton";
import SetDetailModal from "@/components/SetDetailModal";
import SwapModal from "@/components/SwapModal";
import { usePageLoading } from "@/components/LoadingProvider";
import StatusBadge from "@/components/StatusBadge";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatDay, formatTime } from "@/lib/dates";
import type {
  ApiAdminUser,
  ApiIncomingSwap,
  ApiMyAssignment,
  ApiSet,
  ApiSwapRequest,
} from "@/lib/types";

export default function SwapsPage() {
  const [mine, setMine] = useState<ApiMyAssignment[] | null>(null);
  const [openSwaps, setOpenSwaps] = useState<ApiSwapRequest[] | null>(null);
  // Targeted trades awaiting MY accept/reject (shown in Cover Requests).
  const [incoming, setIncoming] = useState<ApiIncomingSwap[] | null>(null);
  // The assignment I'm offering in the swap picker (null = picker closed).
  const [swapAssignment, setSwapAssignment] = useState<ApiMyAssignment | null>(
    null
  );
  // Full sets (with rosters) for the "Details" modal — the /api/assignments and
  // /api/swaps payloads omit assignments, so we fetch the sets alongside them
  // and look one up by id when a Details button is clicked.
  const [allSets, setAllSets] = useState<ApiSet[] | null>(null);
  // The set whose roster modal is open (its id), or null. adminUsersByOrg feeds
  // the modal's assignment dropdowns for orgs I administer (empty = read-only).
  const [detailSetId, setDetailSetId] = useState<string | null>(null);
  const [adminUsersByOrg, setAdminUsersByOrg] = useState<
    Record<string, ApiAdminUser[]>
  >({});
  // Id of the row currently updating (shows inline dots), and a flag for the
  // bulk "confirm all" button — so a mutation never remounts the whole page.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmingAll, setConfirmingAll] = useState(false);
  // Navbar org switcher: "all" or one org — filters both sections. Rows show
  // an org chip while several orgs are mixed together.
  const { orgs, viewOrgId, isAdminOf } = useOrgs();
  const { data: session } = useSession();
  const myId = session?.user?.id;
  const showOrgChips = viewOrgId === "all" && (orgs?.length ?? 0) > 1;

  const reload = useCallback(async () => {
    // Wait until the org context has loaded before fetching. viewOrgId starts
    // at its "all" default and only settles to the persisted org once /api/orgs
    // resolves; fetching before then would fire once unscoped and again after
    // it settles. `orgs` in the deps re-runs this the moment it does.
    if (!orgs) return;
    // Both endpoints return arrays; fall back to [] on any error so a hiccup
    // shows an empty list instead of crashing on `.map`.
    const orgParam = viewOrgId === "all" ? "" : `?orgId=${viewOrgId}`;
    const [mineData, swapsData, setsData, incomingData] = await Promise.all([
      fetchJsonArray<ApiMyAssignment>(`/api/assignments${orgParam}`),
      fetchJsonArray<ApiSwapRequest>(`/api/swaps${orgParam}`),
      fetchJsonArray<ApiSet>(`/api/sets${orgParam}`),
      fetchJsonArray<ApiIncomingSwap>(
        `/api/swaps/proposals/incoming${orgParam}`
      ),
    ]);
    setMine(mineData);
    setOpenSwaps(swapsData);
    setAllSets(setsData);
    setIncoming(incomingData);
    // Nudge the navbar to refresh its red dot.
    window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
  }, [orgs, viewOrgId]);

  // Accept or reject a targeted swap proposed to me.
  async function respondSwap(proposalId: string, action: "accept" | "reject") {
    setBusyId(proposalId);
    try {
      await fetch(`/api/swaps/proposals/${proposalId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  // Withdraw a swap I proposed (restores both slots to their prior status).
  async function cancelSwap(proposalId: string) {
    setBusyId(proposalId);
    try {
      await fetch(`/api/swaps/proposals/${proposalId}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  // One admin-users fetch per org I administer — feeds the Details modal's
  // assignment dropdowns (mirrors the calendar page). Non-admin orgs stay
  // absent, so the modal opens read-only for them.
  useEffect(() => {
    const adminOrgIds = (orgs ?? []).filter((o) => o.isAdmin).map((o) => o.id);
    if (adminOrgIds.length === 0) return;
    Promise.all(
      adminOrgIds.map(
        async (orgId) =>
          [
            orgId,
            await fetchJsonArray<ApiAdminUser>("/api/admin/users", {
              headers: orgHeaders(orgId),
            }),
          ] as const
      )
    ).then((pairs) => setAdminUsersByOrg(Object.fromEntries(pairs)));
  }, [orgs]);

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
  // Wait on allSets too so a Details click always finds its full set.
  usePageLoading(!mine || !openSwaps || !allSets || !incoming);
  if (!mine || !openSwaps || !allSets || !incoming) return null;

  const pendingCount = mine.filter((a) => a.status === "PENDING").length;
  // The full set behind the open Details modal (null = closed / not found).
  const detailSet = allSets.find((s) => s.id === detailSetId) ?? null;

  return (
    <div className="space-y-8">
      {/* ── Cover requests I could take + swaps proposed to me ───────── */}
      <section>
        <h1 className="mb-3 text-2xl font-bold">Cover Requests</h1>
        {openSwaps.length === 0 && incoming.length === 0 && (
          <p className="text-gray-500">
            No open cover requests or swaps for your instruments.
          </p>
        )}

        {/* Targeted swaps someone proposed to me — accept takes their set and
            hands them mine; reject leaves both unchanged. */}
        {incoming.length > 0 && (
          <ul className="mb-3 space-y-3">
            {incoming.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-200 dark:border-indigo-800">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      Swap: take {s.receive.label ?? "Worship Set"} —{" "}
                      {INSTRUMENT_LABELS[s.role]}
                      {showOrgChips && <OrgChip name={s.receive.org.name} />}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDay(s.receive.startsAt)} ·{" "}
                      {formatTime(s.receive.startsAt)} · {s.requestedBy.name}{" "}
                      takes your {s.giveUp.label ?? "Worship Set"} (
                      {formatDay(s.giveUp.startsAt)})
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {busyId === s.id ? (
                      <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                    ) : (
                      <>
                        <Button
                          size="sm"
                          onClick={() => respondSwap(s.id, "accept")}
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => respondSwap(s.id, "reject")}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </div>
                </Card>
              </li>
            ))}
          </ul>
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
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDetailSetId(swap.set.id)}
                  >
                    Details
                  </Button>
                  {busyId === swap.id ? (
                    <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <Button size="sm" onClick={() => takeSwap(swap.id)}>
                      Take this set
                    </Button>
                  )}
                </div>
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
              <Button variant="secondary">Export all my sets (.ics)</Button>
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
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setDetailSetId(a.set.id)}
                  >
                    Details
                  </Button>
                  {busyId === a.id ? (
                    <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                  ) : a.status === "PENDING_SWAP" ? (
                    // Frozen mid-trade: the requester can withdraw; the
                    // recipient acts from Cover Requests above.
                    a.pendingSwap?.isRequester ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => cancelSwap(a.pendingSwap!.proposalId)}
                      >
                        Cancel swap
                      </Button>
                    ) : (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        Respond in Cover Requests ↑
                      </span>
                    )
                  ) : (
                    <>
                      {a.status !== "SWAP_REQUESTED" ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => act(a.id, "requestSwap")}
                          >
                            Request cover
                          </Button>
                          {/* Targeted trade with a specific person's set. */}
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setSwapAssignment(a)}
                          >
                            Swap
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => act(a.id, "cancelSwap")}
                        >
                          Cancel cover request
                        </Button>
                      )}
                      {/* Confirm sits last so the primary action is rightmost. */}
                      {a.status === "PENDING" && (
                        <Button size="sm" onClick={() => act(a.id, "confirm")}>
                          Confirm
                        </Button>
                      )}
                    </>
                  )}
                  {/* Per-set .ics download (confirmed sets only). */}
                  {a.status === "CONFIRMED" && (
                    <ExportIcsButton
                      href={`/api/export/${a.set.id}`}
                      label="Export this set (.ics)"
                      size="sm"
                    />
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* Roster modal opened by any "Details" button. Admin powers are per set
          (only admins of the set's org can edit); everyone else sees it
          read-only. */}
      <SetDetailModal
        set={detailSet}
        onClose={() => setDetailSetId(null)}
        currentUserId={myId}
        isAdmin={isAdminOf(detailSet?.org?.id)}
        users={detailSet?.org ? adminUsersByOrg[detailSet.org.id] ?? [] : []}
        allSets={allSets}
        onChanged={reload}
      />

      {/* Targeted-swap picker opened by a "Swap" button. */}
      <SwapModal
        assignment={swapAssignment}
        onClose={() => setSwapAssignment(null)}
        onProposed={reload}
      />
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
