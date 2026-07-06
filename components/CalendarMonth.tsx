"use client";
// Custom-styled month calendar. One month at a time, ‹ › arrows to move
// between months, and every set rendered as a clickable "slot" chip on its
// day. Clicking a chip calls onSelectSet (the page opens SetDetailModal).
// Days with more sets than fit show a "+N more" button that opens a small
// day list. Fully Tailwind-styled; light + dark aware.
import { useMemo, useState } from "react";
import Modal from "./common/Modal";
import StatusBadge from "./StatusBadge";
import { INSTRUMENT_LABELS } from "@/lib/constants";
import { formatTime } from "@/lib/dates";
import { setStatus } from "@/lib/setStatus";
import type { ApiSet } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// How many chips to show in a cell before collapsing into "+N more".
const MAX_CHIPS = 3;

// A set's overall confirmation state → dot color (see lib/setStatus). Red for
// a cover request, amber if anyone's still pending, green once all confirmed,
// null when the set has no one yet.
function setStatusDot(set: ApiSet): string | null {
  switch (setStatus(set)) {
    case "cover":
      return "bg-red-500";
    case "unconfirmed":
      return "bg-amber-500";
    case "confirmed":
      return "bg-green-500";
    default:
      return null; // empty
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
  isAdmin = false,
  onCreateOnDay,
}: {
  sets: ApiSet[];
  myId?: string;
  onSelectSet: (set: ApiSet) => void;
  isAdmin?: boolean;
  // Admin only: clicking a day cell's hover "+" opens the create form there.
  onCreateOnDay?: (date: Date) => void;
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
  // Day whose full set list is expanded in the "+N more" popup (or null).
  const [openDay, setOpenDay] = useState<Date | null>(null);

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

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  const goToMonth = (delta: number) =>
    setViewMonth(new Date(year, month + delta, 1));
  const goToday = () =>
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  const openDaySets = openDay
    ? setsByDay.get(dayKey(openDay)) ?? []
    : [];

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Header: month title + navigation */}
      <div className="flex items-center justify-between gap-2 px-4 py-3">
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
      <div className="grid grid-cols-7 border-t border-gray-200 dark:border-gray-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const inMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          // Past days (and days outside this month) are dimmed.
          const muted = !inMonth || date < startOfToday;
          const daySets = setsByDay.get(dayKey(date)) ?? [];
          const shown = daySets.slice(0, MAX_CHIPS);
          const overflow = daySets.length - shown.length;

          return (
            <div
              key={date.toISOString()}
              className={`group relative min-h-[104px] border-b border-r border-gray-100 p-1.5 dark:border-gray-700/60 ${
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
              <div className="mb-1 flex justify-end">
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

              <div className="space-y-1">
                {shown.map((set) => (
                  <SlotChip
                    key={set.id}
                    set={set}
                    mine={isMine(set)}
                    myId={myId}
                    onClick={() => onSelectSet(set)}
                  />
                ))}
                {overflow > 0 && (
                  <button
                    onClick={() => setOpenDay(date)}
                    className="w-full rounded px-1.5 py-0.5 text-left text-xs font-medium text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
                  >
                    +{overflow} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* "+N more" day popup: full list of that day's sets */}
      <Modal
        open={openDay !== null}
        onClose={() => setOpenDay(null)}
        title={
          openDay
            ? openDay.toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : ""
        }
      >
        <ul className="space-y-2">
          {openDaySets.map((set) => (
            <li key={set.id}>
              <button
                onClick={() => {
                  setOpenDay(null);
                  onSelectSet(set);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left text-sm hover:border-indigo-400 dark:border-gray-700"
              >
                <span>
                  <span className="font-medium">
                    {set.label ?? "Worship Set"}
                  </span>
                  <span className="ml-2 text-gray-500 dark:text-gray-400">
                    {formatTime(set.startsAt)}
                  </span>
                </span>
                {isMine(set) && (
                  <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
                    You
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

// One set rendered as a compact, clickable chip inside a day cell. A colored
// dot shows the set's confirmation status; hovering a set you're on reveals a
// popover with the role(s) you're playing and whether you've confirmed.
function SlotChip({
  set,
  mine,
  myId,
  onClick,
}: {
  set: ApiSet;
  mine: boolean;
  myId?: string;
  onClick: () => void;
}) {
  const dot = setStatusDot(set);
  const myAssignments = myId
    ? set.assignments.filter((a) => a.user.id === myId)
    : [];

  return (
    <div className="group relative">
      <button
        onClick={onClick}
        title={`${set.label ?? "Worship Set"} · ${formatTime(set.startsAt)}`}
        className={`flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-xs font-medium transition-colors ${
          mine
            ? "bg-indigo-600 text-white hover:bg-indigo-700"
            : "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-900/40 dark:text-indigo-300 dark:hover:bg-indigo-900/70"
        }`}
      >
        {dot && (
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        )}
        <span className="truncate">
          <span className={mine ? "opacity-90" : "opacity-70"}>
            {formatTime(set.startsAt)}
          </span>{" "}
          {set.label ?? "Worship Set"}
        </span>
      </button>

      {/* Hover popover: the roles I'm playing on this set + my status. */}
      {mine && myAssignments.length > 0 && (
        <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden min-w-[11rem] rounded-lg border border-gray-200 bg-white p-2 text-xs shadow-lg group-hover:block dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-1 font-semibold text-gray-900 dark:text-gray-100">
            {set.label ?? "Worship Set"}
          </p>
          <ul className="space-y-1">
            {myAssignments.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 text-gray-700 dark:text-gray-300"
              >
                <span>{INSTRUMENT_LABELS[a.role]}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
