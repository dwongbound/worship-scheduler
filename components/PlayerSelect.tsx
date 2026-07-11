"use client";
// Assignment dropdown for one roster slot (SetDetailModal). Unlike a native
// <select> — whose option list the OS positions however it likes (often
// centered over the control on macOS) — this opens a styled list *directly
// below* the box. It also marks people who can't serve at this set's time:
// they stay in the list (so you can see who they are) but are disabled and
// labelled "(unavailable)", and available people are sorted to the top.
import { useEffect, useRef, useState } from "react";

export interface PlayerOption {
  id: string;
  name: string;
  available: boolean;
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
  const ref = useRef<HTMLDivElement>(null);

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

  const choose = (userId: string) => {
    onChange(userId);
    setOpen(false);
  };

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
        <ul
          role="listbox"
          // Indigo-tinted surface so the open list reads as distinct from the
          // gray modal behind it.
          className="absolute left-0 top-full z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-indigo-200 bg-indigo-50 py-1 shadow-xl dark:border-indigo-700 dark:bg-indigo-900"
        >
          <OptionRow label="None" active={!selected} onClick={() => choose("")} />
          {/* The current occupant, shown checked so you can see who's in the slot. */}
          {selected && (
            <OptionRow label={selected.name} active onClick={() => choose(selected.id)} />
          )}
          {options.map((o) => (
            <OptionRow
              key={o.id}
              label={o.available ? o.name : `${o.name} (unavailable)`}
              disabled={!o.available}
              onClick={() => choose(o.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function OptionRow({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <li role="option" aria-selected={!!active} aria-disabled={!!disabled}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`block w-full px-3 py-1.5 text-left text-sm
          ${
            disabled
              ? "cursor-not-allowed text-gray-400 dark:text-gray-500"
              : "hover:bg-indigo-100 dark:hover:bg-indigo-800"
          }
          ${active ? "font-medium text-indigo-700 dark:text-indigo-200" : "text-gray-800 dark:text-gray-100"}`}
      >
        {label}
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
