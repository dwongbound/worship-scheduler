"use client";
// Phone-sized day picker: one week of tappable day cells, with arrows on
// either side and a swipe gesture for the same move.
//
// It stands in for the month calendar, which is desktop-only — its cells carry
// the blocked windows in words ("6a–5p") and there's no honest way to fit
// seven of those across a 375px screen. A week at a time gives each day a
// thumb-sized target and room for its actual state, and tapping one blocks or
// clears it exactly the way clicking a calendar cell does.
import { useEffect, useMemo, useRef, useState } from "react";
import { toYmd } from "@/components/common/DateSelect";
import { dayBlockLevel, dayIsRepeating } from "@/lib/availability";
import { DAY_LABELS } from "@/lib/constants";
import type { ApiUnavailability } from "@/lib/types";

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** The Sunday on or before `d` — weeks run Sun–Sat, like the calendar's grid. */
function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -d.getDay());
}

/** "Aug 23 – 29", or "Aug 30 – Sep 5" when the week straddles two months. */
function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const month = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  const tail =
    start.getMonth() === end.getMonth()
      ? `${end.getDate()}`
      : `${month(end)} ${end.getDate()}`;
  return `${month(start)} ${start.getDate()} – ${tail}`;
}

export default function WeekStrip({
  entries,
  onEditDays,
  highlightRange,
  busy = false,
}: {
  entries: ApiUnavailability[];
  // Same signature the calendar edits with: an inclusive [start, end] of
  // YYYY-MM-DD days, and whether to block (true) or clear (false) them. The
  // strip only ever edits one day at a time.
  onEditDays: (startYmd: string, endYmd: string, blocked: boolean) => void;
  // The selected request's window: its days get a ring, and the strip opens on
  // the week the window starts in (the month calendar pulls the same way).
  highlightRange?: { start: string; end: string } | null;
  busy?: boolean;
}) {
  const today = startOfDay(new Date());
  const [weekStart, setWeekStart] = useState(() => startOfWeek(today));
  // Which week a swipe/arrow landed on is the user's business once they've
  // moved; only a CHANGE of request re-aims the strip.
  const lensStart = highlightRange?.start ?? null;
  useEffect(() => {
    if (!lensStart) return;
    const start = new Date(lensStart);
    // Never jump backwards into a window that's already underway — the part
    // still to come is the part you can answer.
    setWeekStart(startOfWeek(start > today ? start : new Date()));
    // `today` is a fresh Date each render, so it can't be a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lensStart]);

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart]
  );

  // Swipe: horizontal drag past a thumb's worth of travel moves one week.
  const touchX = useRef<number | null>(null);
  function onTouchEnd(e: React.TouchEvent) {
    const from = touchX.current;
    touchX.current = null;
    if (from === null) return;
    const dx = e.changedTouches[0].clientX - from;
    if (Math.abs(dx) < 40) return;
    setWeekStart((w) => addDays(w, dx < 0 ? 7 : -7));
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
      {/* Week nav — arrows for precision, and a way home from six swipes out.
          That one is worded as an action ("Back to this week"), not a bare
          "This week": sitting under the date range, a noun phrase reads as a
          caption labelling the week you're already on. */}
      <div className="flex items-center justify-between px-2 py-2">
        <ArrowButton
          direction="prev"
          onClick={() => setWeekStart((w) => addDays(w, -7))}
        />
        <div className="flex flex-col items-center">
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {weekLabel(weekStart)}
          </span>
          {weekStart.getTime() !== startOfWeek(today).getTime() && (
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(today))}
              className="text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              Back to this week
            </button>
          )}
        </div>
        <ArrowButton
          direction="next"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
        />
      </div>

      <div
        className="flex touch-pan-y gap-1 px-2 pb-2"
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX;
        }}
        onTouchEnd={onTouchEnd}
      >
        {days.map((date) => {
          const ymd = toYmd(date);
          const level = dayBlockLevel(entries, ymd);
          const repeating = level !== null && dayIsRepeating(entries, ymd);
          const isPast = date < today;
          const isToday = date.getTime() === today.getTime();
          const inWindow =
            !!highlightRange &&
            ymd >= toYmd(new Date(highlightRange.start)) &&
            ymd <= toYmd(new Date(highlightRange.end));
          return (
            <button
              key={ymd}
              type="button"
              data-date={ymd}
              disabled={isPast || busy}
              aria-pressed={level !== null}
              aria-label={`${DAY_LABELS[date.getDay()]} ${date.getDate()}${
                level === "full"
                  ? ", blocked all day"
                  : level === "partial"
                    ? ", partly blocked"
                    : ", free"
              }`}
              // A tap on a blocked day clears it, on a free day blocks it —
              // the calendar's single-click toggle, one day at a time.
              onClick={() => onEditDays(ymd, ymd, level === null)}
              className={`relative flex flex-1 flex-col items-center gap-1 overflow-hidden rounded-lg py-2 transition-colors ${
                inWindow ? "ring-1 ring-inset ring-indigo-300 dark:ring-indigo-500/60" : ""
              } ${
                isPast
                  ? "cursor-not-allowed bg-gray-50 text-gray-400 dark:bg-gray-900/50 dark:text-gray-600"
                  : level === "full"
                    ? "bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200"
                    : level === "partial"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                      : // Free and still to come: faintly green, so an untouched
                        // strip reads as "I'm available", not "no data".
                        "bg-emerald-50 text-gray-700 dark:bg-emerald-950/30 dark:text-gray-200"
              }`}
            >
              {/* A weekly repeat gets the calendar's diagonal hatch: it can't
                  be cleared for one date, so it shouldn't look like a tap
                  will do it. */}
              {repeating && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(-45deg, rgba(120,113,120,0.20) 0 4px, transparent 4px 9px)",
                  }}
                />
              )}
              <span className="relative text-[11px] font-medium uppercase opacity-70">
                {DAY_LABELS[date.getDay()].slice(0, 1)}
              </span>
              <span
                className={`relative flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold tabular-nums ${
                  isToday ? "bg-indigo-600 text-white" : ""
                }`}
              >
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* What the colours mean, and what a tap does — the strip has no room to
          spell either out on the cells themselves. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-rose-400" /> All day
        </span>
        <span className="flex items-center gap-1">
          <i className="h-2 w-2 rounded-full bg-amber-400" /> Part of the day
        </span>
        <span className="flex items-center gap-1">
          <i
            className="h-2 w-2 rounded-full"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, rgba(120,113,120,0.6) 0 2px, transparent 2px 4px)",
            }}
          />
          Weekly
        </span>
        <span className="ml-auto">Tap a day to block it.</span>
      </div>
    </div>
  );
}

// Week back / week forward.
function ArrowButton({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === "prev" ? "Previous week" : "Next week"}
      className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-100"
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <path
          d={direction === "prev" ? "M12 4l-5 6 5 6" : "M8 4l5 6-5 6"}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
