"use client";
// Assignment dropdown for one roster slot (SetDetailModal). Unlike a native
// <select> — whose option list the OS positions however it likes (often
// centered over the control on macOS) — this opens a styled list *directly
// below* the box. It also marks people who can't serve at this set's time:
// they stay in the list (so you can see who they are) but are disabled and
// labelled "(unavailable)", and available people are sorted to the top. People
// marked inactive on the set's team are flagged the same way ("(inactive)").
//
// Like common/Dropdown, the open list renders in a PORTAL on document.body,
// positioned with fixed coordinates measured from the control. It has to: the
// staged-review modal puts these inside horizontally-scrolling card rows
// (`overflow-x-auto`, which makes the vertical axis scroll too), so an
// absolutely-positioned list gets sliced off at the row's edge. At body level
// nothing clips it, and it flips above the control when the space below is
// too tight.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface PlayerOption {
  id: string;
  name: string;
  available: boolean;
  // Marked inactive on this set's team — never auto-scheduled, but an admin can
  // still pick them by hand, so it's a label (like `available`), not a filter.
  inactive?: boolean;
  // How many times this person is already scheduled in the surrounding weeks
  // (±2 weeks of this set). Drives the "least-scheduled first" ordering and is
  // shown as a muted count. Optional — callers that don't compute it omit it.
  count?: number;
  // True when picking this person here would make them an eligible musical
  // director (an MD-capable role + they're an MD). Shows a "(MD)" hint in the
  // open list only — never on the collapsed control after selection.
  md?: boolean;
}

// Where the portaled list sits: pinned to the control's left edge and width,
// anchored from the top (hanging below) or the bottom (flipped above).
interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

// Gap between the control and the list, and the margin kept off the viewport
// edge so the list never sits flush against it.
const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
// Below this much room, squeezing the list is worse than flipping it above the
// control — a few visible names is not a usable picker.
const MIN_MENU_HEIGHT = 160;

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
  // This slot was hand-picked and is pinned against a re-run of the scheduler
  // (staged review modal). Purely cosmetic here — an indigo box, so a locked
  // roster reads apart from an auto-filled one; the caller owns the state.
  locked?: boolean;
}

export default function PlayerSelect({
  selected,
  options,
  onChange,
  disabled,
  dashed,
  locked,
  widthClass = "w-48",
}: PlayerSelectProps) {
  const [open, setOpen] = useState(false);
  // Type-to-search query, filtering the option list by name while open.
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Measure the control and pin the list to it. Called on open and again
  // whenever anything moves the control underneath it.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    // Hang below by default; flip up only when below is genuinely cramped AND
    // there's more room the other way.
    const flip = below < MIN_MENU_HEIGHT && above > below;
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(flip
        ? { bottom: window.innerHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
      // Never taller than the room it has — the list scrolls inside instead of
      // running off the screen.
      maxHeight: Math.max(MIN_MENU_HEIGHT, flip ? above : below),
    });
  }, []);

  // Before paint, so the list never flashes at a stale position.
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  // Keep it pinned while the page moves. Capture phase: the control usually
  // lives inside a scrollable modal body (and a scrolling card row), whose
  // scroll events don't bubble to window.
  useEffect(() => {
    if (!open) return;
    const reposition = () => measure();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, measure]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The list is outside `ref`'s subtree now that it's portaled, so it needs
      // its own check — otherwise every click inside it reads as an outside one.
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) {
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

  // The open list, portaled to the body so no scrolling ancestor can clip it.
  // z-[60] clears the modal's z-50 (same rung common/Dropdown's menu uses).
  const menu =
    open && position ? (
      <div
        ref={menuRef}
        style={{
          left: position.left,
          width: position.width,
          top: position.top,
          bottom: position.bottom,
          maxHeight: position.maxHeight,
        }}
        // Indigo-tinted surface so the open list reads as distinct from the
        // gray modal behind it. `flex-col` + a min-h-0 list lets the list
        // scroll inside whatever height the measurement allowed.
        className="fixed z-[60] flex flex-col overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50 shadow-xl dark:border-indigo-700 dark:bg-indigo-900"
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
        <ul role="listbox" className="min-h-0 flex-1 overflow-auto pb-1">
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
              // "(MD)" flags who can be the musical director here; combines
              // with the "(unavailable)" marker when both apply.
              label={`${o.name}${o.md ? " (MD)" : ""}${
                o.available ? "" : " (unavailable)"
              }${o.inactive ? " (inactive)" : ""}`}
              count={o.count}
              // Unavailable/inactive people are dimmed but still selectable —
              // an admin can deliberately override and assign them anyway.
              muted={!o.available || o.inactive}
              onClick={() => choose(o.id)}
            />
          ))}
          {/* Only a real search shows an empty-state; with no query, an empty
              candidate list (e.g. the only role-player is already selected)
              just shows "None" + the current pick, nothing more. */}
          {q && filtered.length === 0 && (
            <li className="px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400">
              No matches.
            </li>
          )}
        </ul>
      </div>
    ) : null;

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
              : locked
                ? "border-indigo-400 bg-indigo-50 font-medium dark:border-indigo-500 dark:bg-indigo-900/40"
                : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-800"
          }`}
      >
        <span className="truncate">{selected ? selected.name : "None"}</span>
        <Chevron open={open} />
      </button>

      {menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}

function OptionRow({
  label,
  active,
  disabled,
  muted,
  count,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  // Dimmed but still clickable (e.g. an unavailable person an admin may
  // override). `disabled` blocks selection; `muted` only greys the row.
  muted?: boolean;
  // Times already scheduled in the surrounding weeks; shown as a muted badge so
  // admins can see why the list is ordered the way it is.
  count?: number;
  onClick: () => void;
}) {
  const dim = disabled || muted;
  return (
    <li role="option" aria-selected={!!active} aria-disabled={!!disabled}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm
          ${disabled ? "cursor-not-allowed" : "hover:bg-indigo-100 dark:hover:bg-indigo-800"}
          ${
            active
              ? "font-medium text-indigo-700 dark:text-indigo-200"
              : dim
                ? "text-gray-400 dark:text-gray-500"
                : "text-gray-800 dark:text-gray-100"
          }`}
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
