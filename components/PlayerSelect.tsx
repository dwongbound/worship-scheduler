"use client";
// Assignment dropdown for one roster slot (SetDetailModal). Unlike a native
// <select> — whose option list the OS positions however it likes (often
// centered over the control on macOS) — this opens a styled list *directly
// below* the box. It also marks people who can't serve at this set's time:
// they stay in the list (so you can see who they are) but are disabled and
// labelled "(unavailable)", and available people are sorted to the top.
import { useEffect, useMemo, useRef, useState } from "react";

export interface PlayerOption {
  id: string;
  name: string;
  available: boolean;
  // How many times this person is already scheduled in the surrounding weeks
  // (±2 weeks of this set). Drives the "least-scheduled first" ordering and is
  // shown as a muted count. Optional — callers that don't compute it omit it.
  count?: number;
}

interface PlayerSelectProps {
  // The person currently in this slot, or null for an empty slot.
  selected: { id: string; name: string } | null;
  // Assignable candidates (excludes whoever is already in `selected`), already
  // sorted available-first by the caller.
  options: PlayerOption[];
  // Called with the chosen user id, or "" to clear the slot (None).
  onChange: (userId: string) => void;
  disabled?: boolean;
  // Empty slots get a dashed, muted box to read as "nobody yet".
  dashed?: boolean;
  // Tailwind width class for the control. Defaults to a fixed w-48; grid layouts
  // (the staged review modal) pass "w-full" to fill their column.
  widthClass?: string;
}

export default function PlayerSelect({
  selected,
  options,
  onChange,
  disabled,
  dashed,
  widthClass = "w-48",
}: PlayerSelectProps) {
  const [open, setOpen] = useState(false);
  // Type-to-search query, filtering the option list by name while open.
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click or Escape.
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

  // Reset the search each time the list closes; focus the box when it opens so
  // you can start typing a name immediately.
  useEffect(() => {
    if (open) searchRef.current?.focus();
    else setQuery("");
  }, [open]);

  const choose = (userId: string) => {
    onChange(userId);
    setOpen(false);
  };

  // Filter candidates by the typed query (case-insensitive substring). The
  // caller already sorted them (least-scheduled / available first), so we keep
  // that order.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options),
    [options, q]
  );

  return (
    <div className={`relative ${widthClass}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1 text-left text-sm disabled:opacity-50
          ${
            dashed && !selected
              ? "border-dashed border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400"
              : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
          }`}
      >
        <span className="truncate">{selected ? selected.name : "None"}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div
          // Indigo-tinted surface so the open list reads as distinct from the
          // gray modal behind it.
          className="absolute left-0 top-full z-20 mt-1 w-full rounded-lg border border-indigo-200 bg-indigo-50 shadow-xl dark:border-indigo-700 dark:bg-indigo-900"
        >
          {/* Type-to-search: filters the list by name as you type. */}
          <div className="p-1.5">
            <input
              ref={searchRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name…"
              className="w-full rounded border border-indigo-200 bg-white px-2 py-1 text-sm
                focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
                dark:border-indigo-700 dark:bg-gray-800"
            />
          </div>
          <ul role="listbox" className="max-h-56 overflow-auto pb-1">
            {/* "None" and the current occupant only show on an unfiltered list. */}
            {!q && (
              <OptionRow label="None" active={!selected} onClick={() => choose("")} />
            )}
            {!q && selected && (
              <OptionRow label={selected.name} active onClick={() => choose(selected.id)} />
            )}
            {filtered.map((o) => (
              <OptionRow
                key={o.id}
                label={o.available ? o.name : `${o.name} (unavailable)`}
                count={o.count}
                disabled={!o.available}
                onClick={() => choose(o.id)}
              />
            ))}
            {filtered.length === 0 && (
              <li className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
                No matches.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function OptionRow({
  label,
  active,
  disabled,
  count,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  // Times already scheduled in the surrounding weeks; shown as a muted badge so
  // admins can see why the list is ordered the way it is.
  count?: number;
  onClick: () => void;
}) {
  return (
    <li role="option" aria-selected={!!active} aria-disabled={!!disabled}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm
          ${
            disabled
              ? "cursor-not-allowed text-gray-400 dark:text-gray-500"
              : "hover:bg-indigo-100 dark:hover:bg-indigo-800"
          }
          ${active ? "font-medium text-indigo-700 dark:text-indigo-200" : "text-gray-800 dark:text-gray-100"}`}
      >
        <span className="truncate">{label}</span>
        {count !== undefined && count > 0 && (
          <span
            className="shrink-0 text-xs text-gray-400 dark:text-gray-500"
            title={`Scheduled ${count} time${count === 1 ? "" : "s"} within ±2 weeks`}
          >
            ×{count}
          </span>
        )}
      </button>
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
