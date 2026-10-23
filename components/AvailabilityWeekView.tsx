"use client";
// The availability WEEK view: Sunday to Saturday left to right, the hours of
// the day top to bottom, and every block drawn as a box over the time it
// covers — the way a calendar app shows a week. The month calendar answers
// "which days"; this answers "which hours", which is what you need to check an
// "Import from Google Calendar" against your own calendar. Read-only: blocks
// are made with the form and deleted from the list, as in the month view.
// It draws 6 AM to 10 PM at a fixed height, with no scroll box of its own.
// Layout maths: lib/weekView.ts.
import { useEffect, useState } from "react";
import { toYmd } from "@/components/common/DateSelect";
import { FULL_DAY_MIN } from "@/lib/availability";
import {
  VIEW_END_MIN,
  VIEW_START_MIN,
  clipToView,
  compactTime,
  dayBlocks,
  shiftWeek,
  weekDays,
  weekStart,
  type BlockKind,
} from "@/lib/weekView";
import type { ApiUnavailability } from "@/lib/types";

// One hour's height. The sixteen hours from 6 AM to 10 PM make the whole box.
const HOUR_PX = 28;
const FIRST_HOUR = VIEW_START_MIN / 60;
const HOURS = (VIEW_END_MIN - VIEW_START_MIN) / 60;
const minuteY = (m: number) => ((m - VIEW_START_MIN) / 60) * HOUR_PX;

const KIND_CLASSES: Record<BlockKind, string> = {
  google: "bg-sky-500/20 border-sky-500 text-sky-900 dark:text-sky-100",
  specific: "bg-rose-500/20 border-rose-500 text-rose-900 dark:text-rose-100",
  recurring: "bg-amber-500/20 border-amber-500 text-amber-900 dark:text-amber-100",
};
const KIND_LABELS: Record<BlockKind, string> = {
  google: "From Google Calendar",
  specific: "Blocked by you",
  recurring: "Weekly repeat",
};
const LEGEND_DOT: Record<BlockKind, string> = {
  google: "bg-sky-500",
  specific: "bg-rose-500",
  recurring: "bg-amber-500",
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekTitle(start: Date): string {
  const end = shiftWeek(start, 1);
  end.setDate(end.getDate() - 1);
  const fmt = (d: Date, withYear: boolean) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(withYear ? { year: "numeric" } : {}),
    });
  return `${fmt(start, false)} – ${fmt(end, true)}`;
}

export default function AvailabilityWeekView({
  entries,
  highlightRange,
  googleImport = false,
}: {
  entries: ApiUnavailability[];
  // A request's window (YYYY-MM-DD, inclusive): days outside it are dimmed,
  // and the view jumps to the week it starts in — as the month view does.
  highlightRange?: { start: string; end: string } | null;
  // Is Import from Google Calendar set up? Without it the legend has no
  // Google entry — unless blocks from an earlier import are still here.
  googleImport?: boolean;
}) {
  const [start, setStart] = useState(() => {
    if (highlightRange) {
      const [y, m, d] = highlightRange.start.split("-").map(Number);
      return weekStart(new Date(y, m - 1, d));
    }
    return weekStart(new Date());
  });
  useEffect(() => {
    if (!highlightRange) return;
    const [y, m, d] = highlightRange.start.split("-").map(Number);
    if (y && m && d) setStart(weekStart(new Date(y, m - 1, d)));
  }, [highlightRange?.start]);

  const todayYmd = toYmd(new Date());
  const days = weekDays(start);
  const legend = (Object.keys(KIND_LABELS) as BlockKind[]).filter(
    (k) => k !== "google" || googleImport || entries.some((e) => e.fromGoogle),
  );

  return (
    <div
      data-testid="availability-week-view"
      className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-label="Previous week"
          onClick={() => setStart((s) => shiftWeek(s, -1))}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ‹
        </button>
        <h3
          data-testid="week-view-title"
          className="flex-1 text-center text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {weekTitle(start)}
        </h3>
        <button
          type="button"
          onClick={() => setStart(weekStart(new Date()))}
          className="rounded-lg px-2 py-1 text-sm text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10"
        >
          Today
        </button>
        <button
          type="button"
          aria-label="Next week"
          onClick={() => setStart((s) => shiftWeek(s, 1))}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ›
        </button>
      </div>

      {/* Day headings, lined up over the columns below. */}
      <div className="grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))] border-y border-gray-200 text-center text-xs dark:border-gray-700">
        <div />
        {days.map((d) => {
          const ymd = toYmd(d);
          const outside =
            highlightRange && (ymd < highlightRange.start || ymd > highlightRange.end);
          return (
            <div
              key={ymd}
              className={`py-1.5 ${outside ? "opacity-40" : ""} ${
                ymd === todayYmd
                  ? "font-semibold text-indigo-600 dark:text-indigo-300"
                  : "text-gray-600 dark:text-gray-300"
              }`}
            >
              <div>{WEEKDAYS[d.getDay()]}</div>
              <div className="text-sm">{d.getDate()}</div>
            </div>
          );
        })}
      </div>

      {/* The hours, 6 AM to 10 PM, all on screen at once. */}
      <div data-testid="week-hours" className="overflow-hidden">
        <div
          className="relative grid grid-cols-[2.25rem_repeat(7,minmax(0,1fr))]"
          style={{ height: HOURS * HOUR_PX }}
        >
          {/* Hour labels + the horizontal rule for each hour. */}
          <div className="relative">
            {Array.from({ length: HOURS }, (_, i) => (
              <div
                key={i}
                className="absolute right-1 -translate-y-1/2 text-[10px] text-gray-400"
                style={{ top: i * HOUR_PX }}
              >
                {/* The top line's label would hang off the box; 7a onward. */}
                {i === 0 ? "" : compactTime((FIRST_HOUR + i) * 60)}
              </div>
            ))}
          </div>
          {days.map((d) => {
            const ymd = toYmd(d);
            const outside =
              highlightRange && (ymd < highlightRange.start || ymd > highlightRange.end);
            return (
              <div
                key={ymd}
                data-testid={`week-day-${ymd}`}
                className={`relative border-l border-gray-200 dark:border-gray-700 ${
                  outside ? "bg-gray-50 dark:bg-gray-900/40" : ""
                }`}
              >
                {Array.from({ length: HOURS }, (_, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 border-t border-gray-100 dark:border-gray-700/60"
                    style={{ top: i * HOUR_PX }}
                  />
                ))}
                {clipToView(dayBlocks(entries, d)).map((b) => {
                  const label =
                    b.startMinute === 0 && b.endMinute >= FULL_DAY_MIN
                      ? "All day"
                      : `${compactTime(b.startMinute)}–${compactTime(b.endMinute)}`;
                  return (
                    <div
                      key={`${b.id}-${b.startMinute}`}
                      data-testid="week-block"
                      data-kind={b.kind}
                      title={`${KIND_LABELS[b.kind]}: ${label}`}
                      className={`absolute overflow-hidden rounded border-l-2 px-0.5 text-[10px] leading-tight ${KIND_CLASSES[b.kind]}`}
                      style={{
                        top: minuteY(b.top),
                        height: Math.max(minuteY(b.bottom) - minuteY(b.top), 6),
                        left: `calc(${(b.lane / b.lanes) * 100}% + 1px)`,
                        width: `calc(${100 / b.lanes}% - 2px)`,
                      }}
                    >
                      {/* The time fits on tablets and up; on a phone the
                          column is too narrow, and the box speaks for itself. */}
                      <span className="hidden sm:inline">{label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200 px-3 py-2 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300">
        {legend.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${LEGEND_DOT[k]}`} />
            {KIND_LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  );
}
