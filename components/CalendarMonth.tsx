"use client";
// Custom-styled month calendar. One month at a time, ‹ › arrows to move
// between months, and every set rendered as a clickable "slot" chip on its
// day. Clicking a chip calls onSelectSet (the page opens SetDetailModal).
// A day with more sets than fit scrolls inside its own cell (scrollbar hidden),
// with top/bottom fade + chevron cues marking that there's more out of view.
// Fully Tailwind-styled; light + dark aware.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { roleLabel } from "@/lib/teamRoles";
import Link from "next/link";
import StatusBadge from "./StatusBadge";
import LoadingDots from "./common/LoadingDots";
import { type AssignmentStatus } from "@/lib/constants";
import { formatTime } from "@/lib/dates";
import { setStatus, type SetStatus } from "@/lib/setStatus";
import type { ApiSet, ApiSwapRequest } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A set's overall state → dot color (see lib/setStatus). Red means the roster
// needs an admin — either a cover request or an unfilled slot (an emptied
// placeholder set is all unfilled slots, so it reads red too). Amber if
// everyone's aboard but someone hasn't confirmed; green once all confirmed.
// What each dot colour means, in words — colour alone can't say whether a red
// dot is an open slot or a cover request.
const STATUS_TITLES: Record<SetStatus, string> = {
  cover: "Cover requested",
  understaffed: "Needs people — open slots",
  unconfirmed: "Waiting on confirmations",
  confirmed: "Fully confirmed",
};

function setStatusDot(set: ApiSet): string {
  switch (setStatus(set)) {
    case "cover":
    case "understaffed":
      return "bg-red-500";
    case "unconfirmed":
      return "bg-amber-500";
    default:
      return "bg-green-500";
  }
}

// Local-time day key, e.g. "2026-6-3". Groups sets by the day they start.
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export default function CalendarMonth({
  sets,
  myId,
  onSelectSet,
  onConfirm,
  takeableSwaps = [],
  isAdmin = false,
  onCreateOnDay,
  onViewMonthChange,
}: {
  sets: ApiSet[];
  myId?: string;
  onSelectSet: (set: ApiSet) => void;
  // Confirm one of my assignments straight from its calendar popover.
  onConfirm?: (assignmentId: string) => Promise<void>;
  // Open cover requests the current user could take (from /api/swaps). A chip
  // whose set has one shows a "you can cover this" popover linking to /swaps.
  takeableSwaps?: ApiSwapRequest[];
  isAdmin?: boolean;
  // Admin only: clicking a day cell's hover "+" opens the create form there.
  onCreateOnDay?: (date: Date) => void;
  // Fired with the 1st of whichever month is now in view. The calendar page
  // uses it to widen its /api/sets window, so paging into a month outside the
  // default ±3 months loads that month's sets instead of showing it empty.
  onViewMonthChange?: (firstOfMonth: Date) => void;
}) {
  const today = new Date();
  // Midnight today — anything strictly before this is a past day.
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate()
  );
  // The month currently in view, anchored to its 1st at midnight.
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // Group sets by local day, each day's list sorted by start time.
  const setsByDay = useMemo(() => {
    const map = new Map<string, ApiSet[]>();
    for (const set of sets) {
      const key = dayKey(new Date(set.startsAt));
      const list = map.get(key) ?? [];
      list.push(set);
      map.set(key, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    }
    return map;
  }, [sets]);

  // Build the grid: whole weeks (Sun–Sat) covering the month.
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const gridStart = new Date(year, month, 1 - firstWeekday);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
  }, [year, month]);

  const isMine = (set: ApiSet) =>
    !!myId && set.assignments.some((a) => a.user.id === myId);

  // setId → the cover requests on that set the current user could take.
  const takeableBySet = useMemo(() => {
    const map = new Map<string, ApiSwapRequest[]>();
    for (const swap of takeableSwaps) {
      const list = map.get(swap.set.id) ?? [];
      list.push(swap);
      map.set(swap.set.id, list);
    }
    return map;
  }, [takeableSwaps]);

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  // Both nav paths go through this so the parent is always told — a second
  // setViewMonth call added later can't silently skip the notification.
  const showMonth = (firstOfMonth: Date) => {
    setViewMonth(firstOfMonth);
    onViewMonthChange?.(firstOfMonth);
  };
  const goToMonth = (delta: number) => showMonth(new Date(year, month + delta, 1));
  const goToday = () =>
    showMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  // Whole weeks (Sun–Sat) shown — drives the day grid's row template.
  const weekRows = cells.length / 7;

  return (
    // A flex column so the header + weekday labels stay put while the day grid
    // fills the remaining height (and scrolls inside itself if the viewport is
    // too short — keeping the page itself from scrolling).
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header: month title + navigation */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {monthLabel}
        </h2>
        <div className="flex items-center gap-1">
          <button
            onClick={goToday}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Today
          </button>
          <button
            onClick={() => goToMonth(-1)}
            aria-label="Previous month"
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ChevronLeft />
          </button>
          <button
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className="grid shrink-0 grid-cols-7 border-t border-gray-200 dark:border-gray-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid — fills the remaining height, its rows sharing it evenly so
          the whole month always fits the page rather than forcing a scroll.
          `minmax(0, 1fr)` lets the rows shrink to fit a short viewport (each
          cell is overflow-hidden and collapses extra sets into "+N more");
          overflow-y-auto stays only as a safety net for an extreme squeeze. */}
      <div
        className="grid min-h-0 flex-1 grid-cols-7 overflow-y-auto"
        style={{ gridTemplateRows: `repeat(${weekRows}, minmax(0, 1fr))` }}
      >
        {cells.map((date, i) => {
          const inMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          // Past days (and days outside this month) are dimmed.
          const muted = !inMonth || date < startOfToday;
          const daySets = setsByDay.get(dayKey(date)) ?? [];

          return (
            <div
              key={date.toISOString()}
              className={`group relative flex min-h-0 flex-col overflow-hidden border-b border-r border-gray-100 p-1.5 dark:border-gray-700/60 ${
                muted
                  ? "bg-gray-50 text-gray-400 dark:bg-gray-900/50"
                  : "bg-white dark:bg-gray-800"
              }`}
            >
              {/* Admins: a "+" to create a set on this day. Faintly visible so
                  it's discoverable, and it fills in solid on hover. Only on
                  current/future days of this month. */}
              {isAdmin && !muted && onCreateOnDay && (
                <button
                  onClick={() => onCreateOnDay(date)}
                  aria-label={`Add set on ${date.toLocaleDateString()}`}
                  className="absolute left-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full text-sm leading-none text-indigo-400 opacity-50 transition hover:bg-indigo-600 hover:text-white hover:opacity-100 group-hover:opacity-100"
                >
                  +
                </button>
              )}

              {/* Date number; today gets a filled indigo pill */}
              <div className="mb-1 flex shrink-0 justify-end">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                    isToday
                      ? "bg-indigo-600 text-white"
                      : muted
                        ? "text-gray-400 dark:text-gray-600"
                        : "text-gray-700 dark:text-gray-300"
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>

              {/* All of the day's chips, scrollable within the cell (scrollbar
                  hidden) with fade + chevron cues when there's more out of view.
                  The fade blends to the cell's own bg, which differs when muted. */}
              <DayChips
                fadeFrom={
                  muted
                    ? "from-gray-50 dark:from-gray-900/50"
                    : "from-white dark:from-gray-800"
                }
              >
                {daySets.map((set) => (
                  <SlotChip
                    key={set.id}
                    set={set}
                    mine={isMine(set)}
                    myId={myId}
                    past={new Date(set.startsAt) < today}
                    onClick={() => onSelectSet(set)}
                    onConfirm={onConfirm}
                    covers={takeableBySet.get(set.id) ?? []}
                  />
                ))}
              </DayChips>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A day cell's scrollable chip list. Fills the cell's remaining height and
// scrolls internally with the scrollbar hidden; a top and/or bottom fade plus a
// small chevron appear only when content is clipped in that direction, so it's
// clear there are more sets above/below. `fadeFrom` carries the gradient's
// start color (matching the cell bg) so the fade blends seamlessly.
function DayChips({
  children,
  fadeFrom,
}: {
  children: ReactNode;
  fadeFrom: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether content is hidden above / below the current scroll position.
  const [more, setMore] = useState({ up: false, down: false });

  const recompute = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    setMore({
      up: scrollTop > 1,
      // -1 guards against sub-pixel rounding that would otherwise leave the
      // "more below" cue on when fully scrolled.
      down: scrollTop + clientHeight < scrollHeight - 1,
    });
  }, []);

  // Recompute after layout and whenever the cell (or its content) resizes — the
  // grid rows flex with the viewport, so a cell's height isn't fixed.
  useLayoutEffect(() => {
    recompute();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [recompute, children]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={recompute}
        // `[scrollbar-width:none]` (Firefox) + the webkit rule hide the bar.
        className="h-full space-y-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children}
      </div>

      {/* Top fade — shown when scrolled down past the first chip. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 top-0 h-4 bg-gradient-to-b ${fadeFrom} to-transparent transition-opacity duration-150 ${
          more.up ? "opacity-100" : "opacity-0"
        }`}
      />
      {/* Bottom fade + a centered chevron nudging that there's more below. */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex h-5 items-end justify-center bg-gradient-to-t ${fadeFrom} to-transparent transition-opacity duration-150 ${
          more.down ? "opacity-100" : "opacity-0"
        }`}
      >
        <ChevronDown className="h-3 w-3 text-gray-400 dark:text-gray-500" />
      </div>
    </div>
  );
}

// One set rendered as a compact, clickable chip inside a day cell. A colored
// dot shows the set's confirmation status; hovering a set you're on reveals a
// popover with the role(s) you're playing, where you can confirm each.
function SlotChip({
  set,
  mine,
  myId,
  past,
  onClick,
  onConfirm,
  covers,
}: {
  set: ApiSet;
  mine: boolean;
  myId?: string;
  // The set already happened — rendered dimmed (but still clickable).
  past?: boolean;
  onClick: () => void;
  onConfirm?: (assignmentId: string) => Promise<void>;
  // Cover requests on this set the current user could take (may be empty).
  covers: ApiSwapRequest[];
}) {
  const dot = setStatusDot(set);
  const myAssignments = myId
    ? set.assignments.filter((a) => a.user.id === myId)
    : [];
  // Id of the assignment whose confirm is in flight (shows dots on that row).
  const [busyId, setBusyId] = useState<string | null>(null);

  // A popover shows for sets I'm on (confirm my roles) and/or sets with a cover
  // request I could take (link to the swaps tab).
  const hasPopover = myAssignments.length > 0 || covers.length > 0;
  const chipRef = useRef<HTMLDivElement>(null);
  // Popover viewport position, or null when hidden. We render the popover into
  // a body portal with `fixed` positioning so the calendar card's
  // `overflow-hidden` (there for its rounded corners) can't clip it — the old
  // absolute popover was cut off at the card's edge.
  const [pop, setPop] = useState<{
    left: number;
    top?: number;
    bottom?: number;
  } | null>(null);
  // Grace timer so the pointer can travel from chip into the popover across the
  // small gap without it closing.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const POPOVER_WIDTH = 288; // matches w-72

  function openPopover() {
    if (!hasPopover || !chipRef.current) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = chipRef.current.getBoundingClientRect();
    const margin = 8;
    // Keep the popover on-screen horizontally.
    const left = Math.min(
      Math.max(rect.left, margin),
      window.innerWidth - POPOVER_WIDTH - margin
    );
    // Flip above the chip when there's not enough room below and more room up.
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < 200 && rect.top > spaceBelow;
    setPop(
      openUp
        ? { left, bottom: window.innerHeight - rect.top }
        : { left, top: rect.bottom }
    );
  }

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setPop(null), 80);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  // A fixed-positioned popover would drift on scroll/resize — just close it.
  useEffect(() => {
    if (!pop) return;
    const close = () => setPop(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [pop]);

  async function confirm(assignmentId: string) {
    if (!onConfirm) return;
    setBusyId(assignmentId);
    try {
      await onConfirm(assignmentId);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      ref={chipRef}
      className="relative"
      onMouseEnter={openPopover}
      onMouseLeave={scheduleClose}
    >
      <button
        onClick={onClick}
        title={`${set.label ?? "Worship Set"} · ${formatTime(set.startsAt)}`}
        className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs font-medium transition ${
          mine
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/70"
        } ${
          // Past sets read as done: dimmed + desaturated, but still a live
          // button. Hovering restores full opacity so it's clearly clickable.
          past ? "opacity-50 grayscale-[35%] hover:opacity-100" : ""
        }`}
      >
        <span
          title={STATUS_TITLES[setStatus(set)]}
          aria-label={STATUS_TITLES[setStatus(set)]}
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`}
        />
        <span className="truncate">
          <span className={mine ? "opacity-90" : "opacity-70"}>
            {formatTime(set.startsAt)}
          </span>{" "}
          {set.label ?? "Worship Set"}
        </span>
      </button>

      {/* Hover popover: the roles I'm playing on this set, each with a confirm
          control. Portaled to <body> so it escapes the calendar card's clip.
          The py padding bridges the gap to the chip so the pointer can travel
          into the popover without it closing. */}
      {hasPopover &&
        pop &&
        createPortal(
          <div
            className="fixed z-50 w-72 max-w-[calc(100vw-1rem)]"
            style={{ left: pop.left, top: pop.top, bottom: pop.bottom }}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
          >
            <div className={pop.bottom !== undefined ? "pb-1" : "pt-1"}>
              <div className="rounded-lg border border-gray-200 bg-white p-2.5 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <p className="mb-1.5 font-semibold text-gray-900 dark:text-gray-100">
                  {set.label ?? "Worship Set"}
                </p>
                {myAssignments.length > 0 && (
                  <ul className="space-y-1.5">
                    {myAssignments.map((a) => (
                      <li
                        key={a.id}
                        className="flex items-center justify-between gap-3 whitespace-nowrap text-gray-700 dark:text-gray-300"
                      >
                        <span>{roleLabel(a.role)}</span>
                        <ConfirmControl
                          status={a.status}
                          busy={busyId === a.id}
                          canConfirm={!!onConfirm}
                          onConfirm={() => confirm(a.id)}
                        />
                      </li>
                    ))}
                  </ul>
                )}

                {/* Cover requests I could take on this set — link straight to
                    the matching entry on the swaps tab to hit "Take this set". */}
                {covers.length > 0 && (
                  <div
                    className={
                      myAssignments.length > 0
                        ? "mt-2 border-t border-gray-200 pt-2 dark:border-gray-700"
                        : ""
                    }
                  >
                    <p className="mb-1 text-gray-500 dark:text-gray-400">
                      Cover needed — you can take{" "}
                      {covers.map((c) => roleLabel(c.role)).join(", ")}.
                    </p>
                    {/* The requesters' optional notes, if any. */}
                    {covers.some((c) => c.reason) && (
                      <ul className="mb-1 space-y-0.5">
                        {covers
                          .filter((c) => c.reason)
                          .map((c) => (
                            <li
                              key={c.id}
                              className="italic text-gray-500 dark:text-gray-400"
                            >
                              “{c.reason}” — {c.user.name}
                            </li>
                          ))}
                      </ul>
                    )}
                    <Link
                      href={`/swaps#cover-${covers[0].id}`}
                      className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      Take this set →
                    </Link>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

// The per-role confirm control in a chip's popover: a yellow "Confirm" button
// while pending that flips to a green "Confirmed" pill once done. Swap requests
// keep their red status badge (nothing to confirm there).
function ConfirmControl({
  status,
  busy,
  canConfirm,
  onConfirm,
}: {
  status: AssignmentStatus;
  busy: boolean;
  canConfirm: boolean;
  onConfirm: () => void;
}) {
  if (busy) {
    return <LoadingDots className="text-indigo-600 dark:text-indigo-400" />;
  }
  if (status === "CONFIRMED") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500 px-2.5 py-0.5 text-xs font-semibold text-white">
        ✓ Confirmed
      </span>
    );
  }
  if (status === "SWAP_REQUESTED") {
    return <StatusBadge status={status} />;
  }
  // PENDING (and no confirm handler falls back to the plain badge).
  if (!canConfirm) return <StatusBadge status={status} />;
  return (
    <button
      onClick={onConfirm}
      className="rounded-full bg-yellow-400 px-2.5 py-0.5 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-500"
    >
      Confirm
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M12.5 15l-5-5 5-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d="M7.5 5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Small down-chevron cue at the bottom of a scrollable day cell.
function ChevronDown({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M5 7.5l5 5 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
