"use client";
// Custom-styled date picker — a drop-in replacement for <input type="date">.
// The native control renders an OS-specific "mm/dd/yyyy" box + calendar that
// ignores our theme; this opens a styled calendar *directly below* the field
// (same popup pattern as PlayerSelect) so light/dark and spacing stay on-brand.
//
// Values are yyyy-mm-dd strings (same as the native input emitted), so callers
// only swap the onChange signature: (e) => setX(e.target.value) becomes
// (v) => setX(v). `min`/`max` are also yyyy-mm-dd and gate selectable days.
import { useEffect, useMemo, useRef, useState } from "react";

// Weekday headers, Sunday-first to match the calendar grid below.
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// yyyy-mm-dd <-> local Date, parsed by hand so we never touch UTC (new
// Date("2026-07-07") would parse as midnight UTC and shift a day in the US).
export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
function fromYmd(value: string): Date | null {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
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
  value: string; // yyyy-mm-dd, or "" for no date
  onChange: (value: string) => void;
  min?: string; // yyyy-mm-dd — earlier days are disabled
  max?: string; // yyyy-mm-dd — later days are disabled
  required?: boolean;
  disabled?: boolean;
}

export default function DateSelect({
  label,
  value,
  onChange,
  min,
  max,
  required,
  disabled,
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
  const [view, setView] = useState(initialView);
  // Open above the field when there isn't room below (e.g. near the bottom of
  // the page) — otherwise the calendar spills off-screen and clips.
  const [dropUp, setDropUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Re-center whenever the picker (re)opens.
  useEffect(() => {
    if (open) setView(initialView());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, value]);

  // On open, pick the direction with more room. The popup is ~340px tall
  // (month header + 6-week grid + footer); flip up only when below can't fit
  // it but above can.
  useEffect(() => {
    if (!open || !ref.current) return;
    const POPUP_HEIGHT = 340;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setDropUp(spaceBelow < POPUP_HEIGHT && spaceAbove > spaceBelow);
  }, [open]);

  // Close on outside click or Escape (mirrors PlayerSelect).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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

  // The 42 cells (6 weeks) of the visible month, including the leading/trailing
  // spillover days from the neighbouring months so the grid is always full.
  const cells = useMemo(() => {
    const year = view.getFullYear();
    const month = view.getMonth();
    const firstWeekday = new Date(year, month, 1).getDay();
    const start = new Date(year, month, 1 - firstWeekday);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const todayYmd = toYmd(new Date());
  // Out of the [min, max] window? String compare is safe on fixed-width yyyy-mm-dd.
  const outOfRange = (ymd: string) =>
    (min && ymd < min) || (max && ymd > max);

  const pick = (d: Date) => {
    onChange(toYmd(d));
    setOpen(false);
  };
  const shiftMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

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
          <span className={value ? "" : "text-gray-400 dark:text-gray-500"}>
            {value ? displayLabel(value) : "mm/dd/yyyy"}
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

        {open && (
          <div
            role="dialog"
            className={`absolute left-0 z-20 w-72 rounded-lg border border-indigo-200 bg-indigo-50 p-3 shadow-xl dark:border-indigo-700 dark:bg-indigo-900 ${
              dropUp ? "bottom-full mb-1" : "top-full mt-1"
            }`}
          >
            {/* Month header + prev/next navigation. */}
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                {MONTHS[view.getMonth()]} {view.getFullYear()}
              </span>
              <div className="flex gap-1">
                <NavButton label="Previous month" onClick={() => shiftMonth(-1)}>
                  <path d="M12 15l-4-5 4-5" />
                </NavButton>
                <NavButton label="Next month" onClick={() => shiftMonth(1)}>
                  <path d="M8 5l4 5-4 5" />
                </NavButton>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-0.5 text-center">
              {WEEKDAYS.map((w, i) => (
                <span
                  key={i}
                  className="py-1 text-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {w}
                </span>
              ))}
              {cells.map((d) => {
                const ymd = toYmd(d);
                const inMonth = d.getMonth() === view.getMonth();
                const selected = ymd === value;
                const isToday = ymd === todayYmd;
                const blocked = !!outOfRange(ymd);
                return (
                  <button
                    key={ymd}
                    type="button"
                    disabled={blocked}
                    onClick={() => pick(d)}
                    className={`h-8 rounded text-sm transition-colors
                      ${blocked ? "cursor-not-allowed text-gray-300 dark:text-gray-600" : "hover:bg-indigo-100 dark:hover:bg-indigo-800"}
                      ${!inMonth && !blocked ? "text-gray-400 dark:text-gray-500" : ""}
                      ${inMonth && !blocked && !selected ? "text-gray-800 dark:text-gray-100" : ""}
                      ${selected ? "bg-indigo-600 font-semibold text-white hover:bg-indigo-600 dark:bg-indigo-500" : ""}
                      ${isToday && !selected && !blocked ? "font-semibold text-indigo-600 ring-1 ring-inset ring-indigo-400 dark:text-indigo-300" : ""}`}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>

            {/* Clear (only when there's a value to clear) + jump to today. */}
            <div className="mt-2 flex items-center justify-between text-sm">
              {value && !required ? (
                <button
                  type="button"
                  onClick={() => {
                    onChange("");
                    setOpen(false);
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
                onClick={() => pick(new Date())}
                className="font-medium text-indigo-600 hover:underline disabled:opacity-40 dark:text-indigo-400"
              >
                Today
              </button>
            </div>
          </div>
        )}
      </div>
    </label>
  );
}

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
