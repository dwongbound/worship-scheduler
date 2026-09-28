"use client";
// Custom-styled date picker — a drop-in replacement for <input type="date">.
// The native control renders an OS-specific "mm/dd/yyyy" box + calendar that
// ignores our theme; this opens a styled calendar pinned to the field so
// light/dark and spacing stay on-brand.
//
// The calendar renders in a PORTAL on document.body, positioned with fixed
// coordinates measured off the field — the same treatment Dropdown and
// InfoTooltip get, and for the same reason. As an ordinary absolute child it
// was clipped by the first `overflow-hidden` ancestor: on a phone the
// Availabilities form's card cut off the half of the calendar that opened
// above the field, leaving those days invisible AND untappable (the week
// strip behind it swallowed the taps). At body level nothing clips it, and a
// z-index above modals keeps it over a dialog's backdrop too.
//
// Values are yyyy-mm-dd strings (same as the native input emitted), so callers
// only swap the onChange signature: (e) => setX(e.target.value) becomes
// (v) => setX(v). `min`/`max` are also yyyy-mm-dd and gate selectable days.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  VISIBLE_WEEKS,
  addWeeks,
  buildWeeks,
  canStep,
  SWIPE_STEP_PX,
  centredWeek,
  majorityMonth,
  monthKey,
  openingWeek,
  startOfMonth,
  weekDays,
} from "@/lib/calendarScroll";
import { toYmd } from "@/lib/dates";

// Re-exported so the many `import { toYmd } from "@/components/common/DateSelect"`
// call sites keep working; the implementation now lives in lib/dates (pure +
// unit-testable) so lib/availability can share it without importing a component.
export { toYmd };

// Weekday headers, Sunday-first to match the calendar grid below.
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// yyyy-mm-dd -> local Date, parsed by hand so we never touch UTC (new
// Date("2026-07-07") would parse as midnight UTC and shift a day in the US).
// The inverse (toYmd) now lives in lib/dates and is re-exported above.
function fromYmd(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
// How far a finger must travel before a swipe counts as one week's step.

// "Jul 7, 2026" — what the field shows once a day is picked.
function displayLabel(value: string): string {
  const d = fromYmd(value);
  if (!d) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface DateSelectProps {
  label: string;
  value: string; // yyyy-mm-dd, or "" for no date (in range mode: the start)
  onChange?: (value: string) => void; // single mode; use onRangeChange for ranges
  min?: string; // yyyy-mm-dd — earlier days are disabled
  max?: string; // yyyy-mm-dd — later days are disabled
  required?: boolean;
  disabled?: boolean;
  // Whether to ring "today" in the grid. On by default as a helpful anchor;
  // turn it off where today is irrelevant (e.g. the block-out-dates pickers,
  // which only care about the future window, not the current date).
  highlightToday?: boolean;
  // Optional per-day marker rendered as a small dot under the date number:
  // "full" → red, "partial" → amber, null → nothing. Used to surface which days
  // already have availability blocks while picking.
  dayMarker?: (ymd: string) => "full" | "partial" | null;
  // Range mode: pick a start then an end within the same calendar. `value` is
  // the start and `endValue` the end (empty/same-as-start = a single day). The
  // first click sets the start; the next click sets the end (or, if earlier
  // than the start, restarts). onRangeChange fires instead of onChange.
  range?: boolean;
  endValue?: string;
  onRangeChange?: (start: string, end: string) => void;
}

export default function DateSelect({
  label,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
  highlightToday = true,
  dayMarker,
  range,
  endValue,
  onRangeChange,
}: DateSelectProps) {
  const [open, setOpen] = useState(false);
  // The month the calendar shows (independent of the selection): the selected
  // day's month, else today's — but if today falls outside [min, max], start on
  // the nearest in-range month so we don't open onto an all-disabled grid.
  const initialView = () => {
    const selected = fromYmd(value);
    if (selected) return selected;
    const today = toYmd(new Date());
    if (min && today < min) return fromYmd(min)!;
    if (max && today > max) return fromYmd(max)!;
    return new Date();
  };
  // The top row of the five-week window — the only thing that moves. Stepping
  // it by ±1 is what "scrolling" means here; there is no scroll container, so
  // no scrollbar can appear and a step is always exactly one week.
  const [firstWeek, setFirstWeek] = useState(() => openingWeek(initialView()));
  // Where the portaled calendar sits, in viewport coordinates. Null while
  // closed. It opens below the field, or above it when there isn't room below
  // (near the bottom of the page) — otherwise the calendar runs off-screen.
  const [popupPos, setPopupPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  // While picking a range's end, the day under the cursor previews the range.
  const [hoverYmd, setHoverYmd] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // The portaled panel lives outside `ref`'s subtree, so the outside-click
  // check below needs its own handle on it.
  const popupRef = useRef<HTMLDivElement | null>(null);

  // Re-center when the picker OPENS — and only then. `value` used to be a
  // dependency too, which meant picking a range's start moved the window under
  // a popup that stays open. Opening reads the current value anyway, so the
  // transition is the only moment that matters.
  useEffect(() => {
    if (open) setFirstWeek(openingWeek(initialView()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Measure the field and pin the calendar to it. Called on open and again
  // whenever anything moves the field underneath.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const MARGIN = 8; // smallest gap we'll leave against any screen edge
    // The popup is ~280px tall (heading + weekday row + five 34px week rows +
    // footer + padding); flip it above the field only when below can't fit it
    // but above can.
    const POPUP_HEIGHT = 280;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropUp = spaceBelow < POPUP_HEIGHT && rect.top > spaceBelow;

    // w-72 (288px), narrowed on a phone too small for it.
    const width = Math.min(288, window.innerWidth - MARGIN * 2);
    // Left-aligned with the field, then clamped so it can't run off either edge.
    const left = Math.max(
      MARGIN,
      Math.min(rect.left, window.innerWidth - MARGIN - width)
    );
    setPopupPos({
      top: dropUp ? rect.top - 4 - POPUP_HEIGHT : rect.bottom + 4,
      left,
      width,
    });
  }, []);

  // Before paint, so the calendar never flashes at a stale position.
  useLayoutEffect(() => {
    if (open) measure();
    else setPopupPos(null);
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const reposition = (e: Event) => {
      // Scrolling INSIDE the calendar is not the page moving. Re-measuring on
      // it set a fresh popupPos every tick, which re-ran the scroll-to-anchor
      // effect below and yanked the list back to today — the scroll felt
      // locked to the current date.
      if (e.target instanceof Node && popupRef.current?.contains(e.target)) {
        return;
      }
      measure();
    };
    // Capture phase: the field may live inside a scrollable modal body, whose
    // scroll events don't bubble to window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, measure]);

  // Close on outside click or Escape (mirrors PlayerSelect).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Two subtrees now — the field and the portaled calendar. Without the
      // second check, every click inside the calendar would close it.
      if (
        !ref.current?.contains(target) &&
        !popupRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // The five rows on screen: consecutive weeks, oldest first. One unbroken run
  // of days — no per-month grids, no padding cells, nothing to slide.
  //
  // Deliberately NOT clamped to [min, max]: a picker whose bounds sit inside a
  // single month (the Create tab's "From", capped by "To") would have nowhere
  // to move. Days outside the bounds are dimmed and unclickable instead.
  const weeks = useMemo(
    () => buildWeeks(firstWeek, VISIBLE_WEEKS),
    [firstWeek]
  );
  // The month most of the window belongs to: what the heading reads, and which
  // days render at full strength.
  const headerMonth = majorityMonth(weeks) ?? startOfMonth(firstWeek);

  const todayYmd = toYmd(new Date());
  // Out of the [min, max] window? String compare is safe on fixed-width yyyy-mm-dd.
  const outOfRange = (ymd: string) =>
    (min && ymd < min) || (max && ymd > max);

  const pick = (d: Date) => {
    const picked = toYmd(d);
    if (range) {
      // No start yet, or a complete range → begin a fresh range.
      if (!value || endValue) {
        onRangeChange?.(picked, "");
      } else if (picked >= value) {
        // Start is set → this click is the end; close once the range is whole.
        onRangeChange?.(value, picked);
        setOpen(false);
        setHoverYmd(null);
      } else {
        // Clicked before the start → treat it as the new start.
        onRangeChange?.(picked, "");
      }
      return;
    }
    onChange?.(picked);
    setOpen(false);
  };
  // ── Moving through time ────────────────────────────────────────────────
  // One week per gesture, and never faster than the cooldown. The window is an
  // index, so a step is exact — no momentum, no partial rows, nothing to snap
  // back to.
  const lastStep = useRef(0);

  const step = useCallback((delta: number) => {
    const now = Date.now();
    if (!canStep(now, lastStep.current)) return;
    lastStep.current = now;
    setFirstWeek((w) => addWeeks(w, delta));
  }, []);

  // Jump the window to another month — what the ‹ › arrows do, relative to the
  // month currently on screen.
  const stepMonth = (delta: number) =>
    setFirstWeek(
      openingWeek(
        new Date(headerMonth.getFullYear(), headerMonth.getMonth() + delta, 1)
      )
    );

  // The wheel listener is attached by hand for two reasons, and as a CALLBACK
  // REF rather than in an effect:
  //   • by hand, because React's own wheel listener is passive — it can't
  //     preventDefault, so the page behind the popup would scroll instead;
  //   • as a callback ref, because the popup lives in a portal that mounts a
  //     render AFTER `open` flips true (it waits on the measured position). An
  //     effect keyed on `open` therefore ran while the node was still null and
  //     attached nothing at all, which is exactly why the wheel did nothing.
  //     A callback ref fires when the node itself appears, whenever that is.
  //
  // It sits on the whole panel, not just the grid, so the wheel works wherever
  // the cursor happens to be inside the calendar.
  const detachWheel = useRef<(() => void) | null>(null);
  const panelRef = useCallback(
    (node: HTMLDivElement | null) => {
      detachWheel.current?.();
      detachWheel.current = null;
      // Keep the plain ref in step: the outside-click check reads it.
      popupRef.current = node;
      if (!node) return;
      const onWheel = (e: WheelEvent) => {
        if (e.deltaY === 0) return;
        e.preventDefault();
        step(e.deltaY > 0 ? 1 : -1);
      };
      node.addEventListener("wheel", onWheel, { passive: false });
      detachWheel.current = () => node.removeEventListener("wheel", onWheel);
    },
    [step]
  );

  // Touch: a vertical drag steps a week per SWIPE_STEP_PX travelled, rate
  // limited the same way, so a flick can't run away with the calendar.
  const touchY = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const from = touchY.current;
    const y = e.touches[0]?.clientY;
    if (from === null || y === undefined) return;
    const dy = y - from;
    if (Math.abs(dy) < SWIPE_STEP_PX) return;
    // Dragging up (negative dy) pulls later weeks into view, as scrolling does.
    step(dy < 0 ? 1 : -1);
    touchY.current = y;
  };

  // Drop any stale range hover-preview once the popup closes.
  useEffect(() => {
    if (!open) setHoverYmd(null);
  }, [open]);

  // The range currently highlighted: the committed [value, endValue], or a live
  // preview from the start to the hovered day while picking the end.
  const pickingEnd = !!range && !!value && !endValue;
  let rangeLo: string | null = null;
  let rangeHi: string | null = null;
  if (range && value) {
    const other = endValue || (pickingEnd ? hoverYmd : null) || value;
    rangeLo = value <= other ? value : other;
    rangeHi = value <= other ? other : value;
  }

  // Field text: "Jul 7 – Jul 9" for a range, "Jul 7" for a single day/start.
  const displayText = range
    ? value
      ? endValue && endValue !== value
        ? `${displayLabel(value)} – ${displayLabel(endValue)}`
        : displayLabel(value)
      : ""
    : value
      ? displayLabel(value)
      : "";

  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      <div className="relative" ref={ref}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          // Explicit name so the control is "From"/"To" to screen readers (and
          // tests) rather than the label + the "mm/dd/yyyy" placeholder text.
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-60
            dark:border-gray-600 dark:bg-gray-800`}
        >
          <span className={displayText ? "" : "text-gray-400 dark:text-gray-500"}>
            {displayText || "mm/dd/yyyy"}
          </span>
          <CalendarIcon />
        </button>

        {/* A hidden input keeps `required` form validation working and lets
            playwright's getByLabel still find the control by its label. */}
        {required && (
          <input
            type="text"
            required
            value={value}
            onChange={() => {}}
            tabIndex={-1}
            aria-hidden="true"
            className="pointer-events-none absolute h-0 w-0 opacity-0"
          />
        )}

        {open &&
          popupPos &&
          createPortal(
            <div
              ref={panelRef}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              role="dialog"
              // Fixed at the measured coordinates; z above modals (z-50) so the
              // picker still works inside a dialog.
              style={{
                top: popupPos.top,
                left: popupPos.left,
                width: popupPos.width,
              }}
              // touch-none: the panel owns vertical touch, so a swipe anywhere
              // on it steps the weeks instead of scrolling the page behind it.
              className="fixed z-[60] touch-none select-none rounded-lg border border-indigo-200 bg-indigo-50 p-3 shadow-xl dark:border-indigo-700 dark:bg-indigo-900"
            >
              {/* The month heading names whichever month owns most of the five
                  visible rows, so it changes only once the majority of the
                  window is in the next one. The arrows jump a whole month
                  relative to it — stepping week by week to reach next March is
                  no way to spend an afternoon. */}
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  {MONTHS[headerMonth.getMonth()]} {headerMonth.getFullYear()}
                </span>
                <div className="flex gap-1">
                  <NavButton label="Previous month" onClick={() => stepMonth(-1)}>
                    <path d="M12 15l-4-5 4-5" />
                  </NavButton>
                  <NavButton label="Next month" onClick={() => stepMonth(1)}>
                    <path d="M8 5l4 5-4 5" />
                  </NavButton>
                </div>
              </div>

              {/* Weekday header, above the rows so the columns stay labelled
                  however far the window has stepped. */}
              <div className="grid grid-cols-7 gap-0.5 text-center">
                {WEEKDAYS.map((w, i) => (
                  <span
                    key={i}
                    className="py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                  >
                    {w}
                  </span>
                ))}
              </div>

              {/* Five week rows, days running straight through month
                  boundaries. Not a scroll container — the window is an index,
                  stepped a week at a time by the wheel or a swipe — so there is
                  no scrollbar to show, ever, and no partial row to land on. */}
              <div className="touch-none select-none overflow-hidden">
                <div className="grid grid-cols-7 gap-0.5 text-center">
                {weeks.flatMap(weekDays).map((d) => {
                  const ymd = toYmd(d);
                  const isToday = highlightToday && ymd === todayYmd;
                  const blocked = !!outOfRange(ymd);
                  // Range highlight: the two endpoints are "selected"; days
                  // between them get a lighter fill. Single mode keeps its one
                  // selected day.
                  const inRange =
                    !!rangeLo && !!rangeHi && ymd >= rangeLo && ymd <= rangeHi;
                  const isEndpoint = ymd === rangeLo || ymd === rangeHi;
                  const selected = range ? inRange && isEndpoint : ymd === value;
                  const midRange = range && inRange && !isEndpoint;
                  // Days from the neighbouring months are dimmed — a quiet
                  // "this row has crossed over", not a disabled state: they're
                  // as clickable as any other day, and `blocked` below is what
                  // actually greys a day out of use.
                  const otherMonth = monthKey(d) !== monthKey(headerMonth);
                  // Existing-block dot — drawn on every day, since every day on
                  // screen is one you can pick.
                  const marker = dayMarker ? dayMarker(ymd) : null;
                  return (
                    <button
                      key={ymd}
                      type="button"
                      // Stable per-cell date hook: the full date is unique
                      // across the whole scrolling list, where a bare day
                      // number repeats once per month on screen.
                      data-date={ymd}
                      disabled={blocked}
                      onClick={() => pick(d)}
                      onMouseEnter={() => {
                        if (pickingEnd && !blocked) setHoverYmd(ymd);
                      }}
                      className={`relative h-8 rounded text-sm transition-colors
                        ${blocked ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:bg-indigo-100 dark:hover:bg-indigo-800"}
                        ${
                          !blocked && !selected && !midRange
                            ? otherMonth
                              ? "text-gray-400 dark:text-gray-500"
                              : "text-gray-800 dark:text-gray-100"
                            : ""
                        }
                        ${midRange && !selected ? "bg-indigo-100 text-indigo-800 dark:bg-indigo-800/60 dark:text-indigo-100" : ""}
                        ${selected ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-600 dark:bg-indigo-500" : ""}
                        ${isToday && !selected && !midRange && !blocked ? "font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-400 dark:text-indigo-300" : ""}`}
                    >
                      {d.getDate()}
                      {marker && (
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute bottom-0.5 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${
                            marker === "full" ? "bg-rose-500" : "bg-amber-500"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
                </div>
              </div>

              {/* While mid-range, nudge the user to complete it. */}
              {pickingEnd && (
                <p className="mt-2 text-xs font-medium text-indigo-600 dark:text-indigo-300">
                  Now pick the end date (or the same day for a single day).
                </p>
              )}

              {/* Clear (only when there's a value to clear) + jump to today. */}
              <div className="mt-2 flex items-center justify-between text-sm">
                {value && (!required || range) ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (range) {
                        onRangeChange?.("", ""); // stay open to re-pick the start
                      } else {
                        onChange?.("");
                        setOpen(false);
                      }
                    }}
                    className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    Clear
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  disabled={!!outOfRange(todayYmd)}
                  // Navigation, not selection: it snaps the window so today's
                  // week sits in the middle, and leaves the popup open with
                  // today's cell ringed for you to click. Picking here instead
                  // closed the popup, which made the jump invisible — and
                  // "Today" beside "Clear" reads as "take me there", not "fill
                  // this in for me".
                  onClick={() => setFirstWeek(centredWeek(new Date()))}
                  className="font-medium text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
                >
                  Today
                </button>
              </div>
            </div>,
            document.body
          )}
      </div>
    </label>
  );
}

// The ‹ › month jumps in the heading.
function NavButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded p-1 text-gray-500 hover:bg-indigo-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-indigo-800 dark:hover:text-gray-100"
    >
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
        <g stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          {children}
        </g>
      </svg>
    </button>
  );
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4 shrink-0 text-gray-400"
    >
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <rect x="3" y="4.5" width="14" height="12" rx="2" />
        <path d="M3 8h14M7 3v3M13 3v3" />
      </g>
    </svg>
  );
}
