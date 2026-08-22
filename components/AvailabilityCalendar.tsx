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
import { toYmd } from "@/components/common/DateSelect";
import InfoTooltip from "@/components/common/InfoTooltip";
import type { ApiUnavailability } from "@/lib/types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const FULL_DAY_END = 24 * 60; // minutes — a block reaching this covers the day

// A blocked window, written the way you'd say it: "6a", "9:30a", "5p". Short
// enough to sit in a day cell, unlike "6:00 AM", and unambiguous — unlike the
// sunrise/sun/sunset icons this replaced, which couldn't tell 6a–5p apart from
// 7–8a without hovering for the tooltip.
function compactTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 || h === 24 ? "a" : "p";
  const hour12 = h % 12 || 12;
  return m ? `${hour12}:${String(m).padStart(2, "0")}${suffix}` : `${hour12}${suffix}`;
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
// any of them covers the whole day, the blocked windows as readable times, and
// whether the day is covered ONLY by a weekly rule. That last one matters more
// than anything else on the cell: a repeat applies forever and can't be cleared
// for one date, so it's marked (↻ + hatch) rather than left to be inferred from
// three identical-looking Tuesdays. A date blocked by hand overrides the
// pattern and renders as an ordinary block.
interface DayBlocks {
  fullDay: boolean;
  labels: string[]; // blocked windows, compact ("6a–5p"), deduped
  repeating: boolean; // any of them comes from a weekly rule
}

// Does `rule` block `day`? RECURRING matches by weekday, until its endDate if
// it has one (the last day it repeats; null = forever); SPECIFIC and
// DATE_RANGE match when the day falls within [startDate, endDate] (endDate
// defaults to startDate for a single-day specific block).
function ruleAppliesOn(rule: ApiUnavailability, day: Date): boolean {
  if (rule.type === "RECURRING") {
    if (day.getDay() !== rule.dayOfWeek) return false;
    return !rule.endDate || day <= startOfDay(new Date(rule.endDate));
  }
  if (!rule.startDate) return false;
  const start = startOfDay(new Date(rule.startDate));
  const end = rule.endDate ? startOfDay(new Date(rule.endDate)) : start;
  return day >= start && day <= end;
}

export default function AvailabilityCalendar({
  entries,
  onEditDays,
  initialMonth,
  highlightRange,
  compact = false,
  busy = false,
}: {
  entries: ApiUnavailability[];
  // Called when the user edits a run of days: the inclusive [start, end] as
  // YYYY-MM-DD strings, and whether to block (true) or unblock (false) them.
  // A drag always blocks; a single click on an already-blocked day unblocks it
  // (a toggle). Omit to render the calendar read-only.
  onEditDays?: (startYmd: string, endYmd: string, blocked: boolean) => void;
  // Which month to open on (defaults to this one). The admin's read-only view
  // seeds it with the availability request's first month, which is usually not
  // the current one. Only the INITIAL month — remount (via `key`) to re-seed.
  initialMonth?: Date;
  // Lens the calendar onto one date range (YYYY-MM-DD, inclusive) — the window
  // of the availability request being answered. Days inside are ringed, days
  // outside are dimmed, and the view jumps to the range's first month. This is
  // what makes answering a request the SAME calendar rather than a second one.
  highlightRange?: { start: string; end: string } | null;
  // Shorter day cells, for the read-only calendar inside a narrow modal.
  compact?: boolean;
  busy?: boolean;
}) {
  const today = new Date();
  const [viewMonth, setViewMonth] = useState(() => {
    const seed = initialMonth ?? today;
    return new Date(seed.getFullYear(), seed.getMonth(), 1);
  });

  // Selecting a request pulls the view to its window — the whole point of the
  // lens is that you're looking at the month being asked about.
  useEffect(() => {
    if (!highlightRange) return;
    const [y, m] = highlightRange.start.split("-").map(Number);
    if (y && m) setViewMonth(new Date(y, m - 1, 1));
  }, [highlightRange?.start]);

  // Click/drag-to-block is driven entirely by refs + direct DOM styling — never
  // React state — so dragging across days does NOT re-render the calendar. The
  // anchor + current day live in refs; the selection highlight is painted onto
  // the cell elements imperatively, and cleared + committed on pointer-up.
  const startRef = useRef<Date | null>(null);
  const endRef = useRef<Date | null>(null);
  // Which gesture is in flight. Left button paints days BLOCKED; right button
  // paints them CLEAR — "I'm free all of these" — wiping every dated block on
  // them, partial-day ones included. Set on pointer-down and read on pointer-up.
  const modeRef = useRef<"block" | "clear">("block");
  const gridRef = useRef<HTMLDivElement>(null);
  const interactive = !!onEditDays && !busy;
  const todayStart = startOfDay(today);

  // Days already covered by an all-day SPECIFIC block — the ones a single click
  // toggles OFF. Recurring/timed blocks aren't togglable this way, so they're
  // excluded. Kept in a ref so the pointer-up handler can read it without being
  // a hook dependency (it wires up once).
  const specificBlockedDays = useMemo(() => {
    const set = new Set<string>();
    for (const e of entries) {
      if (e.type !== "SPECIFIC" || !e.startDate) continue;
      const s = e.startMinute ?? 0;
      const en = e.endMinute ?? FULL_DAY_END;
      if (!(s <= 0 && en >= FULL_DAY_END)) continue; // all-day only
      const end = e.endDate ? startOfDay(new Date(e.endDate)) : null;
      let d = startOfDay(new Date(e.startDate));
      const last = end ?? d;
      for (; d <= last; d = addDays(d, 1)) set.add(toYmd(d));
    }
    return set;
  }, [entries]);
  const blockedDaysRef = useRef(specificBlockedDays);
  blockedDaysRef.current = specificBlockedDays;

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
    const clearing = modeRef.current === "clear";
    const tint = clearing ? "rgba(16, 185, 129, 0.18)" : "rgba(99, 102, 241, 0.18)";
    const edge = clearing ? "#10b981" : "#6366f1";
    grid.querySelectorAll<HTMLElement>("[data-date]").forEach((el) => {
      const ymd = el.dataset.date!;
      const on = lo !== null && hi !== null && ymd >= lo && ymd <= hi;
      el.style.backgroundColor = on ? tint : "";
      el.style.boxShadow = on ? `inset 0 0 0 2px ${edge}` : "";
    });
  };

  const beginDrag = (date: Date, mode: "block" | "clear") => {
    modeRef.current = mode;
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
      if (s && e && onEditDays) {
        const lo = s <= e ? s : e;
        const hi = s <= e ? e : s;
        if (modeRef.current === "clear") {
          // Right-drag always clears, however many days it covers.
          onEditDays(toYmd(lo), toYmd(hi), false);
        } else {
          // A single left-click on an already-blocked day unblocks it
          // (toggle); any other click/drag blocks the run.
          const singleDay = toYmd(lo) === toYmd(hi);
          const blocked = !(singleDay && blockedDaysRef.current.has(toYmd(lo)));
          onEditDays(toYmd(lo), toYmd(hi), blocked);
        }
      }
      modeRef.current = "block";
    };
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
    // paintSelection + blockedDaysRef only read refs (stable), so onEditDays is
    // the only real dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onEditDays]);

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
      // A day you marked by hand WINS over the weekly pattern underneath it:
      // it's the more specific statement, and the one you can act on here
      // (right-click frees a date; it can't punch a hole in a repeat). So when
      // both land on a day, only the dated blocks are drawn — no hatch, no ↻.
      const applying = entries.filter((rule) => ruleAppliesOn(rule, day));
      const dated = applying.filter((rule) => rule.type !== "RECURRING");
      const shown = dated.length > 0 ? dated : applying;

      let fullDay = false;
      const labels = new Set<string>(); // dedupe identical time windows
      for (const rule of shown) {
        // DATE_RANGE carries no time → always a full-day block.
        const start = rule.startMinute ?? 0;
        const end = rule.endMinute ?? FULL_DAY_END;
        if (rule.type === "DATE_RANGE" || (start <= 0 && end >= FULL_DAY_END)) {
          fullDay = true;
        } else {
          labels.add(`${compactTime(start)}–${compactTime(end)}`);
        }
      }
      map.set(date.toISOString(), {
        fullDay,
        labels: [...labels],
        repeating: dated.length === 0 && applying.length > 0,
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
        <div className="flex items-center gap-1.5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {monthLabel}
          </h2>
          {/* How-to lives here (gated on editor mode) instead of a hint line. */}
          {onEditDays && (
            <InfoTooltip
              side="bottom"
              text="Click a day — or drag across several — to block it out (all day). Click a blocked day again to clear it. Right-click (or right-drag) marks days fully free, wiping every dated block on them."
            />
          )}
        </div>
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

      {/* Weekday labels */}
      <div className="grid grid-cols-7 border-t border-gray-200 dark:border-gray-700">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className={`px-2 py-2 text-center font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 ${
              compact ? "text-xs" : "text-[13px]"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid */}
      {/* Right-click is a real gesture here (clear these days), so the browser's
          own menu has to stay out of the way. */}
      <div
        className="grid grid-cols-7"
        ref={gridRef}
        onContextMenu={(e) => {
          if (interactive) e.preventDefault();
        }}
      >
        {cells.map((date) => {
          const inMonth = date.getMonth() === month;
          const isToday = sameDay(date, today);
          const blocks = blocksByDay.get(date.toISOString())!;
          const blocked = blocks.fullDay || blocks.labels.length > 0;
          const blockable = canBlock(date);
          // Past days (this month, before today) can't be blocked — render them
          // muted like out-of-month cells so they don't look clickable.
          const isPast = inMonth && startOfDay(date) < todayStart;
          // Lens state: inside the request's window, or dimmed outside it.
          const ymd = toYmd(date);
          const lensed = !!highlightRange;
          const inWindow =
            lensed &&
            ymd >= highlightRange!.start &&
            ymd <= highlightRange!.end;

          return (
            <div
              key={date.toISOString()}
              data-date={toYmd(date)}
              onPointerDown={(e) => {
                if (!blockable) return;
                // Ignore the middle button and anything exotic.
                if (e.button !== 0 && e.button !== 2) return;
                e.preventDefault(); // don't start a text selection
                beginDrag(date, e.button === 2 ? "clear" : "block");
              }}
              onPointerEnter={() => {
                if (startRef.current && blockable) extendDrag(date);
              }}
              className={`relative ${
                compact ? "min-h-[54px] p-1" : "min-h-[92px] p-1.5"
              } select-none border-b border-r border-gray-100 dark:border-gray-700/60 ${
                lensed && !inWindow ? "opacity-40" : ""
              } ${
                inWindow
                  ? "ring-1 ring-inset ring-indigo-300 dark:ring-indigo-500/60"
                  : ""
              } ${
                blockable
                  ? // Outline the cell on hover instead of washing it in
                    // indigo: the wash sat on top of the rose/amber "blocked"
                    // colors and read as the day being disabled.
                    "cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-500 dark:hover:ring-indigo-400"
                  : ""
              } ${
                !inMonth || (isPast && !blocked)
                  ? "bg-gray-50 text-gray-400 dark:bg-gray-900/50"
                  : blocks.fullDay
                    ? "bg-rose-50 dark:bg-rose-950/40"
                    : blocked
                      ? "bg-amber-50 dark:bg-amber-950/30"
                      : // Free and still to come: faintly green, so an empty
                        // grid reads as "I'm available" rather than "no data".
                        "bg-emerald-50/60 dark:bg-emerald-950/20"
              }`}
            >
              {/* Anything from a weekly rule gets a diagonal hatch. It reads
                  from across the room, unlike a glyph, and it's deliberately
                  a TEXTURE rather than another colour so it layers over the
                  rose/amber "how much is blocked" fill instead of fighting it.
                  Low-alpha slate works on both grounds. */}
              {inMonth && blocks.repeating && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(-45deg, rgba(120,113,120,0.20) 0 4px, transparent 4px 9px)",
                  }}
                />
              )}

              {/* Date number; today gets a filled indigo pill */}
              <div className="relative mb-1 flex justify-end">
                <span
                  className={`flex items-center justify-center rounded-full px-1 font-medium ${
                    compact ? "h-6 min-w-6 text-xs" : "h-7 min-w-7 text-sm"
                  } ${
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

              {/* What's blocked, in words. The ↻ marks anything coming from a
                  weekly rule — the one distinction the old day-part icons
                  couldn't make, and the one that changes what you can do about
                  it (a repeat can't be cleared for a single date). */}
              {inMonth && blocks.fullDay && (
                <div
                  className={`relative flex items-center gap-1 rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700 dark:bg-rose-900/50 dark:text-rose-300 ${
                    compact ? "text-[11px]" : "text-xs"
                  }`}
                >
                  <span className="truncate">All day</span>
                  {blocks.repeating && <RepeatIcon />}
                </div>
              )}
              {inMonth && !blocks.fullDay && blocks.labels.length > 0 && (
                <div className="relative space-y-0.5">
                  {blocks.labels.slice(0, 2).map((label) => (
                    <div
                      key={label}
                      className={`flex items-center gap-1 rounded bg-amber-100 px-1.5 py-0.5 font-medium leading-tight text-amber-800 dark:bg-amber-900/50 dark:text-amber-300 ${
                        compact ? "text-[10px]" : "text-xs"
                      }`}
                    >
                      <span className="truncate tabular-nums">{label}</span>
                      {blocks.repeating && <RepeatIcon />}
                    </div>
                  ))}
                  {blocks.labels.length > 2 && (
                    <div
                      className={`px-1 text-amber-700 dark:text-amber-400 ${
                        compact ? "text-[10px]" : "text-xs"
                      }`}
                    >
                      +{blocks.labels.length - 2} more
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Three states, named. Cheaper than making people infer them from
          colour, and it's where the ↻ gets explained. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-200 px-4 py-2.5 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-emerald-100 ring-1 ring-emerald-300 dark:bg-emerald-900/50 dark:ring-emerald-700" />
          Free
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-amber-100 ring-1 ring-amber-300 dark:bg-amber-900/60 dark:ring-amber-700" />
          Part of the day blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm bg-rose-100 ring-1 ring-rose-300 dark:bg-rose-900/60 dark:ring-rose-700" />
          All day blocked
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm bg-gray-100 ring-1 ring-gray-300 dark:bg-gray-700 dark:ring-gray-600"
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, rgba(120,113,120,0.45) 0 2px, transparent 2px 5px)",
            }}
          />
          <RepeatIcon />
          Repeats every week
        </span>
      </div>
    </div>
  );
}

// Marks a block that comes from a WEEKLY rule rather than this one date — the
// distinction that decides whether you can clear it here at all.
function RepeatIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="repeats weekly"
      role="img"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
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
