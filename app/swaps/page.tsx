"use client";
// "My Sets" tab — everything I'm on, split by what each set is waiting on:
//   1. Covers / Swaps — cover requests I could take, targeted swaps proposed
//      to me, and my own slots mid-handoff (cover offered, swap in progress,
//      or taken and awaiting an admin's approval). Everything in flight.
//   2. Pending — sets needing MY confirmation, individually or all at once.
//   3. Confirmed — settled sets, with the .ics exports.
// One horizon dropdown at the top governs all three (default 3 months); it
// also sizes the /api/sets fetch, so every row shown can open its Details
// modal. Anything past it is counted next to the dropdown, never silently
// dropped.
import { ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { roleLabel } from "@/lib/teamRoles";
import { useSession } from "next-auth/react";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import LoadingDots from "@/components/common/LoadingDots";
import ExportIcsButton from "@/components/ExportIcsButton";
import RequestCoverModal from "@/components/RequestCoverModal";
import SetDetailModal from "@/components/SetDetailModal";
import SwapModal from "@/components/SwapModal";
import { usePageLoading } from "@/components/LoadingProvider";
import StatusBadge from "@/components/StatusBadge";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import Select from "@/components/common/Select";
import { SET_MANAGER_HORIZONS } from "@/lib/constants";
import { formatDay, formatTime, toYmd } from "@/lib/dates";
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
  // Targeted trades awaiting MY accept/reject (shown under Covers / Swaps).
  const [incoming, setIncoming] = useState<ApiIncomingSwap[] | null>(null);
  // The assignment I'm offering in the swap picker (null = picker closed).
  // The assignment whose "Request cover" reason modal is open, or null.
  const [coverForId, setCoverForId] = useState<string | null>(null);
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
  // How far ahead "My sets" looks, in months (see SET_MANAGER_HORIZONS). It
  // bounds BOTH the visible list and the /api/sets window fetched below, so a
  // row can never appear without its full set loaded behind it.
  const [horizonMonths, setHorizonMonths] = useState(
    SET_MANAGER_HORIZONS[0].months
  );
  // The horizon as a concrete end-of-day timestamp: the cutoff for the list and
  // the `to` of the /api/sets fetch. Memoized so reload() keeps a stable
  // identity between renders.
  const horizonEnd = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + horizonMonths);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [horizonMonths]);

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
      // Only /api/sets takes a window; the other three are already scoped to
      // upcoming rows and are small, so they're fetched whole and trimmed to
      // the horizon client-side below.
      fetchJsonArray<ApiSet>(
        `/api/sets${orgParam ? `${orgParam}&` : "?"}from=${toYmd(
          new Date()
        )}&to=${toYmd(horizonEnd)}`
      ),
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
  }, [orgs, viewOrgId, horizonEnd]);

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
  // `reason` is the optional cover note (requestSwap only).
  async function act(assignmentId: string, action: string, reason?: string) {
    setBusyId(assignmentId);
    try {
      await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
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

  // The horizon, as one test every list on the page runs through. Rows are
  // trimmed here rather than server-side — only /api/sets takes a window; the
  // other three payloads are small and already scoped to upcoming rows, so
  // filtering in the client keeps the API surface unchanged.
  const withinHorizon = (startsAt: string) =>
    new Date(startsAt).getTime() <= horizonEnd.getTime();

  const visibleIncoming = incoming.filter((s) =>
    withinHorizon(s.receive.startsAt)
  );
  const visibleOpenSwaps = openSwaps.filter((s) => withinHorizon(s.set.startsAt));
  // My assignments, split by what each is waiting on — every status lands in
  // exactly one section, so no set is listed twice or not at all.
  const visibleMine = mine.filter((a) => withinHorizon(a.set.startsAt));
  const inFlight = visibleMine.filter(
    (a) =>
      a.status === "SWAP_REQUESTED" ||
      a.status === "PENDING_SWAP" ||
      a.status === "PENDING_APPROVAL"
  );
  const pending = visibleMine.filter((a) => a.status === "PENDING");
  // Counted over ALL my sets, not just the visible ones: confirm-all confirms
  // every pending assignment server-side, so scoping this number to the
  // horizon would advertise less than the button performs. The "further out"
  // note above accounts for the gap when the two differ.
  const pendingTotal = mine.filter((a) => a.status === "PENDING").length;
  const confirmed = visibleMine.filter((a) => a.status === "CONFIRMED");
  // Everything the horizon is holding back, across all three sections — said
  // out loud next to the dropdown so a short window never looks like an empty
  // schedule.
  const hiddenCount =
    mine.length -
    visibleMine.length +
    (incoming.length - visibleIncoming.length) +
    (openSwaps.length - visibleOpenSwaps.length);
  // The full set behind the open Details modal (null = closed / not found).
  const detailSet = allSets.find((s) => s.id === detailSetId) ?? null;

  return (
    <div className="space-y-8">
      {/* How far ahead the whole page looks. It sits above the sections rather
          than inside one because it governs all three — and it sizes the
          /api/sets fetch too, so widening it loads the sets behind the newly
          shown rows. */}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {hiddenCount > 0 && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {hiddenCount} further out — widen to see {hiddenCount === 1 ? "it" : "them"}
          </span>
        )}
        <div className="w-40">
          <Select
            label="How far ahead"
            hideLabel
            data-testid="horizon-select"
            value={horizonMonths}
            onChange={(e) => setHorizonMonths(Number(e.target.value))}
          >
            {SET_MANAGER_HORIZONS.map((h) => (
              <option key={h.months} value={h.months}>
                {h.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* ── 1. Covers / swaps — everything mid-handoff ───────────────── */}
      <section>
        {/* Three kinds of row live here (incoming proposals, open cover
            requests, in-flight handoffs), so the count is simply how many are
            in the section. */}
        <SectionHeading
          title="Covers / Swaps"
          count={
            visibleIncoming.length + visibleOpenSwaps.length + inFlight.length
          }
        />
        {visibleOpenSwaps.length === 0 &&
          visibleIncoming.length === 0 &&
          inFlight.length === 0 && (
            <p className="text-sm text-gray-500">
              Nothing in flight — no open cover requests, swaps, or approvals
              waiting.
            </p>
          )}

        {/* Targeted swaps someone proposed to me — accept takes their set and
            hands them mine; reject leaves both unchanged. */}
        {visibleIncoming.length > 0 && (
          <ul className="mb-3 space-y-3">
            {visibleIncoming.map((s) => (
              <li key={s.id}>
                <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-200 dark:border-indigo-800">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      Swap: take {s.receive.label ?? "Worship Set"} —{" "}
                      {roleLabel(s.role)}
                      {showOrgChips && <OrgChip name={s.receive.org.name} />}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDay(s.receive.startsAt)} ·{" "}
                      {formatTime(s.receive.startsAt)} · {s.requestedBy.name}{" "}
                      takes your {s.giveUp.label ?? "Worship Set"} (
                      {formatDay(s.giveUp.startsAt)})
                    </p>
                    {s.reason && (
                      <p className="mt-1 text-sm italic text-gray-500 dark:text-gray-400">
                        “{s.reason}”
                      </p>
                    )}
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

        {visibleOpenSwaps.length > 0 && (
          <ul className="space-y-3">
            {visibleOpenSwaps.map((swap) => (
              // id anchors the calendar's "Take this set →" link (#cover-<id>);
              // scroll-mt keeps it clear of the sticky navbar when jumped to.
              <li key={swap.id} id={`cover-${swap.id}`} className="scroll-mt-24">
                <Card className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {swap.set.label ?? "Worship Set"} — {roleLabel(swap.role)}
                      {showOrgChips && swap.set.org && (
                        <OrgChip name={swap.set.org.name} />
                      )}
                    </p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {formatDay(swap.set.startsAt)} ·{" "}
                      {formatTime(swap.set.startsAt)} · requested by{" "}
                      {swap.user.name}
                    </p>
                    {swap.reason && (
                      <p className="mt-1 text-sm italic text-gray-500 dark:text-gray-400">
                        “{swap.reason}”
                      </p>
                    )}
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
        )}

        {/* My OWN slots mid-handoff: cover offered, swap in progress, or taken
            and waiting on an admin. They sit here rather than under Pending
            because none of them is waiting on me. */}
        {inFlight.length > 0 && (
          <ul className="mt-3 space-y-3">
            {inFlight.map((a) => (
              <li key={a.id}>
                <AssignmentRow
                  a={a}
                  busy={busyId === a.id}
                  showOrgChips={showOrgChips}
                  onDetails={() => setDetailSetId(a.set.id)}
                  onRequestCover={() => setCoverForId(a.id)}
                  onSwap={() => setSwapAssignment(a)}
                  onAct={act}
                  onCancelSwap={cancelSwap}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 2. Pending — waiting on me ───────────────────────────────── */}
      <section>
        <SectionHeading title="Pending" count={pending.length}>
          {pendingTotal > 0 && (
            <Button
              onClick={confirmAll}
              disabled={confirmingAll}
              aria-label="Confirm all pending"
            >
              {confirmingAll ? (
                <LoadingDots size="sm" label="Confirming" />
              ) : (
                `Confirm all pending (${pendingTotal})`
              )}
            </Button>
          )}
        </SectionHeading>
        {pending.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nothing to confirm — you&rsquo;re all caught up.
          </p>
        ) : (
          <ul className="space-y-3">
            {pending.map((a) => (
              <li key={a.id}>
                <AssignmentRow
                  a={a}
                  busy={busyId === a.id}
                  showOrgChips={showOrgChips}
                  onDetails={() => setDetailSetId(a.set.id)}
                  onRequestCover={() => setCoverForId(a.id)}
                  onSwap={() => setSwapAssignment(a)}
                  onAct={act}
                  onCancelSwap={cancelSwap}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 3. Confirmed — settled, and exportable ───────────────────── */}
      <section>
        <SectionHeading title="Confirmed" count={confirmed.length}>
          {/* Plain link download: the browser sends session cookies along.
              Hidden on phones — no .ics export on narrow screens — and hidden
              with nothing confirmed, where it would only ever hand back an
              empty calendar. */}
          {confirmed.length > 0 && (
            <a href="/api/export" download className="hidden sm:block">
              <Button variant="secondary">Export all my sets (.ics)</Button>
            </a>
          )}
        </SectionHeading>
        {confirmed.length === 0 ? (
          <p className="text-sm text-gray-500">No confirmed sets in this window.</p>
        ) : (
          <ul className="space-y-3">
            {confirmed.map((a) => (
              <li key={a.id}>
                <AssignmentRow
                  a={a}
                  busy={busyId === a.id}
                  showOrgChips={showOrgChips}
                  onDetails={() => setDetailSetId(a.set.id)}
                  onRequestCover={() => setCoverForId(a.id)}
                  onSwap={() => setSwapAssignment(a)}
                  onAct={act}
                  onCancelSwap={cancelSwap}
                />
              </li>
            ))}
          </ul>
        )}
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
        onChanged={reload}
      />

      {/* Targeted-swap picker opened by a "Swap" button. */}
      <SwapModal
        assignment={swapAssignment}
        onClose={() => setSwapAssignment(null)}
        onProposed={reload}
      />

      {/* "Request cover" reason prompt. */}
      <RequestCoverModal
        open={coverForId !== null}
        onClose={() => setCoverForId(null)}
        busy={busyId === coverForId}
        onConfirm={async (reason) => {
          const id = coverForId;
          if (!id) return;
          setCoverForId(null);
          await act(id, "requestSwap", reason);
        }}
      />
    </div>
  );
}

// A section label plus whatever controls belong to that section. Deliberately
// quiet — these divide one page into three, so they're a small uppercase tag
// over a rule rather than three competing page titles.
// The longest section title. Rendered invisibly inside every heading to give
// them all one width — see the sizer in SectionHeading.
const WIDEST_TITLE = "Covers / Swaps";

function SectionHeading({
  title,
  count,
  children,
}: {
  title: string;
  // Every section shows one, including a zero — "0" is information ("nothing
  // here"), and a heading that sometimes has a badge and sometimes doesn't
  // makes the three read as different kinds of thing. Omitted counts as 0.
  count?: number;
  children?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      {/* A rule under the label, ending in the same place for all three
          headings — but only as long as it has to be: an invisible copy of the
          LONGEST title sits in the label cell of every heading, so the rule
          measures itself against that rather than a hardcoded width. Rename a
          section and the alignment still holds. */}
      <h2 className="inline-flex items-center gap-4 border-b border-gray-300 pb-1.5 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-600 dark:text-gray-400">
        {/* Sizer and real title stack in one grid cell — the cell is as wide as
            the wider of the two, which is always the sizer. */}
        <span className="grid">
          <span
            aria-hidden
            className="invisible col-start-1 row-start-1 whitespace-nowrap"
          >
            {WIDEST_TITLE}
          </span>
          <span className="col-start-1 row-start-1 truncate">{title}</span>
        </span>
        {/* min-w so a one- and a two-digit count are the same width, and the
            rules still end together. */}
        <span className="inline-flex min-w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-gray-600 dark:bg-gray-700 dark:text-gray-300">
          {count ?? 0}
        </span>
      </h2>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

// One of my assignments. Its actions come from its STATUS, not from the
// section it's listed in, so a row means the same thing wherever it lands.
function AssignmentRow({
  a,
  busy,
  showOrgChips,
  onDetails,
  onRequestCover,
  onSwap,
  onAct,
  onCancelSwap,
}: {
  a: ApiMyAssignment;
  busy: boolean;
  showOrgChips: boolean;
  onDetails: () => void;
  onRequestCover: () => void;
  onSwap: () => void;
  onAct: (assignmentId: string, action: string) => void;
  onCancelSwap: (proposalId: string) => void;
}) {
  return (
    // The whole row is the way into the set — there's no "Details" button any
    // more. On a hover-capable device it glows to say so (Tailwind's `hover:`
    // is already media-gated, so touch screens don't get a stuck highlight).
    // Enter/Space match the click for keyboard users.
    <Card
      role="button"
      tabIndex={0}
      onClick={onDetails}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDetails();
        }
      }}
      className="flex cursor-pointer flex-wrap items-center justify-between gap-3 transition
        hover:border-indigo-300 hover:shadow-md hover:shadow-indigo-500/20
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500
        dark:hover:border-indigo-500 dark:hover:shadow-indigo-400/20"
    >
      <div>
        {/* Status chip rides up here next to the team/org chip so the action
            row below can't overflow the card on phones. */}
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {a.set.label ?? "Worship Set"} — {roleLabel(a.role)}
          {showOrgChips && a.set.org && <OrgChip name={a.set.org.name} />}
          <StatusBadge status={a.status} />
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {formatDay(a.set.startsAt)} · {formatTime(a.set.startsAt)}
        </p>
      </div>
      {/* The actions keep their own jobs: a click here must not also open the
          details modal behind them. */}
      <div
        className="flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {busy ? (
          <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
        ) : a.status === "PENDING_APPROVAL" ? (
          // Taken/accepted, now frozen until an admin approves it.
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Waiting for admin approval
          </span>
        ) : a.status === "PENDING_SWAP" ? (
          // Frozen mid-trade: the requester can withdraw; the recipient acts
          // from the proposal card in this same section.
          a.pendingSwap?.isRequester ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onCancelSwap(a.pendingSwap!.proposalId)}
            >
              Cancel swap
            </Button>
          ) : (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Respond above ↑
            </span>
          )
        ) : (
          <>
            {a.status !== "SWAP_REQUESTED" ? (
              <>
                <Button size="sm" variant="secondary" onClick={onRequestCover}>
                  Request cover
                </Button>
                {/* Targeted trade with a specific person's set. */}
                <Button size="sm" variant="secondary" onClick={onSwap}>
                  Swap
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onAct(a.id, "cancelSwap")}
              >
                Cancel cover request
              </Button>
            )}
            {/* Confirm sits last so the primary action is rightmost. */}
            {a.status === "PENDING" && (
              <Button size="sm" onClick={() => onAct(a.id, "confirm")}>
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
