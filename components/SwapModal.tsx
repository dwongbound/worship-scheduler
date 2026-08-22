"use client";
// Targeted-swap picker: a one-step, infinite-scrolling list of the sets I could
// trade one of my assignments into (same role + team, held by someone else).
// Each row shows the set, who holds it now + their status, and both-direction
// availability, then a "Request swap" that proposes the trade.
import { useCallback, useEffect, useRef, useState } from "react";
import { roleLabel } from "@/lib/teamRoles";
import Modal from "./common/Modal";
import Button from "./common/Button";
import LoadingDots from "./common/LoadingDots";
import StatusBadge from "./StatusBadge";
import { formatDay, formatTime } from "@/lib/dates";
import type { ApiMyAssignment, ApiSwapCandidate } from "@/lib/types";

const PAGE = 20;

export default function SwapModal({
  assignment,
  onClose,
  onProposed,
}: {
  // The assignment I'm offering (null = closed).
  assignment: ApiMyAssignment | null;
  onClose: () => void;
  onProposed: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<ApiSwapCandidate[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Optional note sent with the proposal (shown to the recipient).
  const [reason, setReason] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Guard against overlapping page fetches (scroll can fire rapidly).
  const loadingRef = useRef(false);

  const assignmentId = assignment?.id;

  const loadMore = useCallback(async () => {
    if (!assignmentId || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const skip = items.length;
      const res = await fetch(
        `/api/swaps/candidates?assignmentId=${assignmentId}&skip=${skip}&take=${PAGE}`
      );
      if (!res.ok) throw new Error();
      const data: { items: ApiSwapCandidate[]; hasMore: boolean } =
        await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setHasMore(data.hasMore);
    } catch {
      setHasMore(false);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [assignmentId, items.length]);

  // Reset + first page whenever the modal opens on a new assignment.
  useEffect(() => {
    setItems([]);
    setHasMore(true);
    setError(null);
    setReason("");
    if (assignmentId) {
      loadingRef.current = false;
      loadMore();
    }
    // Intentionally only on assignmentId — loadMore is recreated as items grow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentId]);

  // Infinite scroll: fetch the next page as the sentinel nears the bottom.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || loadingRef.current || !hasMore) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) loadMore();
  };

  async function propose(candidate: ApiSwapCandidate) {
    if (!assignment) return;
    setProposingId(candidate.toAssignmentId);
    setError(null);
    try {
      const res = await fetch("/api/swaps/propose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromAssignmentId: assignment.id,
          toAssignmentId: candidate.toAssignmentId,
          reason,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Could not request the swap.");
        return;
      }
      await onProposed();
      onClose();
    } finally {
      setProposingId(null);
    }
  }

  if (!assignment) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title="Swap this set"
      subtitle={
        <>
          {roleLabel(assignment.role)} ·{" "}
          {assignment.set.label ?? "Worship Set"} ·{" "}
          {formatDay(assignment.set.startsAt)}
        </>
      }
    >
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        Pick a set to trade into. They&apos;ll take your set and you&apos;ll take
        theirs once they accept.
      </p>

      {/* Optional note the recipient sees with the proposal. */}
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional) — e.g. away this weekend"
        rows={2}
        aria-label="Reason for the swap (optional)"
        className="mb-3 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
      />

      {error && (
        <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </p>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="max-h-[55vh] space-y-2 overflow-y-auto pr-1"
      >
        {items.length === 0 && !loading ? (
          <p className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
            No sets to swap with — nobody else plays {roleLabel(assignment.role).toLowerCase()}{" "}
            on upcoming sets for this team.
          </p>
        ) : (
          items.map((c) => (
            <div
              key={c.toAssignmentId}
              className="rounded-lg border border-gray-200 p-3 dark:border-gray-700"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100">
                    {c.set.label ?? "Worship Set"}
                  </p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDay(c.set.startsAt)} · {formatTime(c.set.startsAt)} ·{" "}
                    {c.counterparty.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  {proposingId === c.toAssignmentId ? (
                    <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
                  ) : (
                    <Button size="sm" onClick={() => propose(c)}>
                      Request swap
                    </Button>
                  )}
                </div>
              </div>

              {/* Both-direction availability flags, plus whether they've
                  stepped back from this team (only surfaced when there's
                  something to warn about). */}
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {c.theyInactive && (
                  <span className="text-gray-500 dark:text-gray-400">
                    (inactive) They&apos;re not active on this team right now
                  </span>
                )}
                {!c.youAvailable && (
                  <span className="text-amber-600 dark:text-amber-400">
                    ⚠ You&apos;re unavailable that day
                  </span>
                )}
                {c.theyMarkedUnavailable ? (
                  <span className="text-red-600 dark:text-red-400">
                    ⚠ They previously marked your date unavailable
                  </span>
                ) : (
                  !c.theyAvailable && (
                    <span className="text-amber-600 dark:text-amber-400">
                      ⚠ They&apos;re unavailable your date
                    </span>
                  )
                )}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-center py-3">
            <LoadingDots className="text-indigo-600 dark:text-indigo-400" />
          </div>
        )}
      </div>
    </Modal>
  );
}
