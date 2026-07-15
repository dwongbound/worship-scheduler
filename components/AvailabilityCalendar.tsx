"use client";
// Month calendar that visualizes a user's *unavailability* — the union of
// recurring and specific (dated) blocks. Each day the rules touch is shaded;
// the cell shows "All day" for a full-day block or the blocked time window(s)
// otherwise. Fully Tailwind-styled, light + dark aware.
//
// It's also an editor: click a day — or click-and-drag across several — to
// block them out (an all-day specific block, not tied to any request). The
// scrollable list beside it handles deleting.
import { useEffect, useMemo, useRef, useState } from "react";
import { minutesToTimeLabel } from "@/lib/dates";
import { toYmd } from "@/components/common/DateSelect";
import type { ApiUnavailability } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_END = 24 * 60; // minutes — a block reaching this covers the day

// Times of day, each with a glanceable icon: sunrise = morning, sun =
// afternoon, sunset = night. A blocked window renders the icon(s) for the
// period(s) it touches instead of hard-to-read time text. Night wraps
// midnight, so it carries two ranges.
type Period = "morning" | "afternoon" | "night";
const PERIODS: { key: Period; ranges: [number, number][] }[] = [
  { key: "morning", ranges: [[300, 720]] }, // 5am–12pm → sunrise
  { key: "afternoon", ranges: [[720, 1020]] }, // 12pm–5pm → sun
  { key: "night", ranges: [[1020, 1440], [0, 300]] }, // 5pm–5am → sunset
];

// Which periods a [start, end) minute window overlaps, in day order.
function periodsFor(start: number, end: number): Period[] {
  return PERIODS.filter((p) =>
    p.ranges.some(([s, e]) => start < e && end > s)
  ).map((p) => p.key);
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// The blocks that fall on one calendar day, reduced to what we render: whether
// any of them covers the whole day, plus the distinct day-parts the partial
// windows touch. `periods` is deduped — a day shows at most one icon per
// day-part no matter how many blocks land on it.
interface DayBlocks {
  fullDay: boolean;
  periods: Period[]; // distinct day-parts to show icons for, in day order
  labels: string[]; // each blocked time window — one tooltip line apiece
}

// Does `rule` block `day`? RECURRING matches by weekday; SPECIFIC and
// DATE_RANGE match when the day falls within [startDate, endDate] (endDate
// defaults to startDate for a single-day specific block).
function ruleAppliesOn(rule: ApiUnavailability, day: Date): boolean {
  if (rule.type === "RECURRING") return day.getDay() === rule.dayOfWeek;
  if (!rule.startDate) return false;
  const start = startOfDay(new Date(rule.startDate));
  const end = rule.endDate ? startOfDay(new Date(rule.endDate)) : start;
  return day >= start && day <= end;
}

export default function AvailabilityCalendar({
  entries,
  onBlockDays,
  busy = false,
}: {
  entries: ApiUnavailability[];
  // Called when the user clicks/drags a run of days: the inclusive [start, end]
  // as YYYY-MM-DD strings. Omit to render the calendar read-only.
  onBlockDays?: (startYmd: string, endYmd: string) => void;
  busy?: boolean;
}) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1)
  );

  // Click/drag-to-block is driven entirely by refs + direct DOM styling — never
  // React state — so dragging across days does NOT re-render the calendar. The
  // anchor + current day live in refs; the selection highlight is painted onto
  // the cell elements imperatively, and cleared + committed on pointer-up.
  const startRef = useRef<Date | null>(null);
  const endRef = useRef<Date | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const interactive = !!onBlockDays && !busy;
  const todayStart = startOfDay(today);

  // A day can be blocked if it's in the visible month and not in the past.
  const canBlock = (date: Date) =>
    interactive &&
    date.getMonth() === viewMonth.getMonth() &&
    startOfDay(date) >= todayStart;

  // Tint the cells inside the current [start, end] run; clear the rest. Pure DOM
  // — no setState — so this can run on every pointer-move without a re-render.
  const paintSelection = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const s = startRef.current;
    const e = endRef.current;
    const lo = s && e ? (s <= e ? toYmd(s) : toYmd(e)) : null;
    const hi = s && e ? (s <= e ? toYmd(e) : toYmd(s)) : null;
    grid.querySelectorAll<HTMLElement>("[data-date]").forEach((el) => {
      const ymd = el.dataset.date!;
      const on = lo !== null && hi !== null && ymd >= lo && ymd <= hi;
      el.style.backgroundColor = on ? "rgba(99, 102, 241, 0.18)" : "";
      el.style.boxShadow = on ? "inset 0 0 0 2px #6366f1" : "";
    });
  };

  const beginDrag = (date: Date) => {
    startRef.current = date;
    endRef.current = date;
    paintSelection();
  };
  const extendDrag = (date: Date) => {
    endRef.current = date;
    paintSelection();
  };

  // Commit the current selection (on pointer-up anywhere) into one block. Reads
  // the refs synchronously so a fast click (down→up before any re-render) works.
  useEffect(() => {
    const onUp = () => {
      const s = startRef.current;
      const e = endRef.current;
      startRef.current = null;
      endRef.current = null;
      paintSelection(); // clears the highlight (refs are now null)
      if (s && e && onBlockDays) {
        const lo = s <= e ? s : e;
        const hi = s <= e ? e : s;
        onBlockDays(toYmd(lo), toYmd(hi));
      }
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
    // paintSelection only reads refs (stable), so onBlockDays is the only dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBlockDays]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();

  // Whole weeks (Sun–Sat) covering the visible month.
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay();
    const gridStart = new Date(year, month, 1 - firstWeekday);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
    return Array.from({ length: totalCells }, (_, i) => addDays(gridStart, i));
  }, [year, month]);

  // Precompute the blocks per rendered day so cells stay cheap.
  const blocksByDay = useMemo(() => {
    const map = new Map<string, DayBlocks>();
    for (const date of cells) {
      const day = startOfDay(date);
      let fullDay = false;
      const periodSet = new Set<Period>(); // dedupe day-parts across blocks
      const labels = new Set<string>(); // dedupe identical time windows
      for (const rule of entries) {
        if (!ruleAppliesOn(rule, day)) continue;
        // DATE_RANGE carries no time → always a full-day block.
        const start = rule.startMinute ?? 0;
        const end = rule.endMinute ?? FULL_DAY_END;
        if (rule.type === "DATE_RANGE" || (start <= 0 && end >= FULL_DAY_END)) {
          fullDay = true;
        } else {
          for (const p of periodsFor(start, end)) periodSet.add(p);
          labels.add(`${minutesToTimeLabel(start)} – ${minutesToTimeLabel(end)}`);
        }
      }
      // Keep periods in canonical day order (morning → afternoon → night).
      const periods = PERIODS.map((p) => p.key).filter((k) => periodSet.has(k));
      map.set(date.toISOString(), {
        fullDay,
        periods,
        labels: [...labels],
      });
    }
    return map;
  }, [cells, entries]);

  const monthLabel = viewMonth.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
  const goToMonth = (delta: number) =>
    setViewMonth(new Date(year, month + delta, 1));
  const goToday = () =>
    setViewMonth(new Date(today.getFullYear(), today.getMonth(), 1));

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

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
            <Chevron dir="left" />
          </button>
          <button
            onClick={() => goToMonth(1)}
            aria-label="Next month"
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Chevron dir="right" />
          </button>
        </div>
      </div>

      {/* Hint: shown whenever the calendar is an editor. Gated on onBlockDays
          (not `interactive`) so it stays put while a block is saving — `busy`
          briefly flips `interactive` off and would otherwise flicker it away. */}
      {onBlockDays && (
        <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Click a day — or drag across several — to block them out (all day).
        </p>
      )}

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
      <div className="grid grid-cols-7" ref={gridRef}>
        {cells.map((date) => {
          const inMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          const blocks = blocksByDay.get(date.toISOString())!;
          const blocked = blocks.fullDay || blocks.periods.length > 0;
          const blockable = canBlock(date);
          // Past days (this month, before today) can't be blocked — render them
          // muted like out-of-month cells so they don't look clickable.
          const isPast = inMonth && startOfDay(date) < todayStart;

          return (
            <div
              key={date.toISOString()}
              data-date={toYmd(date)}
              onPointerDown={(e) => {
                if (!blockable) return;
                e.preventDefault(); // don't start a text selection
                beginDrag(date);
              }}
              onPointerEnter={() => {
                if (startRef.current && blockable) extendDrag(date);
              }}
              className={`min-h-[84px] select-none border-b border-r border-gray-100 p-1.5 dark:border-gray-700/60 ${
                blockable
                  ? "cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-900/20"
                  : ""
              } ${
                !inMonth || (isPast && !blocked)
                  ? "bg-gray-50 text-gray-400 dark:bg-gray-900/50"
                  : blocks.fullDay
                    ? "bg-rose-50 dark:bg-rose-950/40"
                    : blocked
                      ? "bg-amber-50 dark:bg-amber-950/30"
                      : "bg-white dark:bg-gray-800"
              }`}
            >
              {/* Date number; today gets a filled indigo pill */}
              <div className="mb-1 flex justify-end">
                <span
                  className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-medium ${
                    isToday
                      ? "bg-indigo-600 text-white"
                      : inMonth && !isPast
                        ? "text-gray-700 dark:text-gray-300"
                        : "text-gray-400 dark:text-gray-600"
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>

              {inMonth && blocks.fullDay && (
                <div className="rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                  All day
                </div>
              )}
              {inMonth && !blocks.fullDay && blocks.periods.length > 0 && (
                <div className="group/chip relative mx-auto w-max">
                  <div className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                    {blocks.periods.map((p) => (
                      <PeriodIcon key={p} period={p} />
                    ))}
                  </div>
                  {/* Instant tooltip (no native title delay) with the actual
                      blocked time window(s). */}
                  <div className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-max max-w-[12rem] space-y-0.5 rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg group-hover/chip:block dark:bg-gray-700">
                    {blocks.labels.map((l) => (
                      <div key={l}>{l}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A small day-part glyph: sunrise (morning), sun (afternoon), sunset (night).
// Drawn at 14px, inheriting the chip's text color.
function PeriodIcon({ period }: { period: Period }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "h-3.5 w-3.5 shrink-0",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-label": period,
    role: "img" as const,
  };
  switch (period) {
    case "morning": // sunrise
      return (
        <svg {...common}>
          <path d="M17 18a5 5 0 0 0-10 0M12 2v4M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4M22 22H2M8 6l4-4 4 4" />
        </svg>
      );
    case "afternoon": // sun
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case "night": // sunset
      return (
        <svg {...common}>
          <path d="M17 18a5 5 0 0 0-10 0M12 9V2M4.9 10.9l1.4 1.4M2 18h2M20 18h2M17.7 12.3l1.4-1.4M22 22H2M16 5l-4 4-4-4" />
        </svg>
      );
  }
}

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
      <path
        d={dir === "left" ? "M12.5 15l-5-5 5-5" : "M7.5 5l5 5-5 5"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
