"use client";
// A person field you can TYPE into: the trigger shows who's picked, and opening
// it gives a search box over the names with the list filtering as you type.
// Enter takes the first match, which is the whole point — picking someone from
// a church roster is "type three letters and go", not "scroll a <select>".
//
// Separate from components/PlayerSelect.tsx, which is the ROSTER picker: that
// one carries availability/inactive/MD flags, serve counts and lock state for a
// seat on a set. This is the plain "which person" field the scheduling-rules
// editor builds its sentences from, so it stays a name and nothing else.
//
// The list is PORTALED to <body> for the reason PlayerSelect's is: this control
// lives inside a modal whose body scrolls, and an absolutely-positioned list
// would be clipped by that scroll box.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface PersonOption {
  id: string;
  name: string;
}

const MENU_GAP = 4;
const VIEWPORT_MARGIN = 8;
const MIN_MENU_HEIGHT = 160;

interface Position {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

export default function PersonPicker({
  value,
  options,
  onChange,
  placeholder = "Pick a person…",
  label,
  disabled = false,
  widthClass = "w-full sm:w-52",
}: {
  value: string;
  options: PersonOption[];
  onChange: (id: string) => void;
  placeholder?: string;
  // Accessible name for the control — the sentence around it is the visible
  // label, so this is what a screen reader announces instead.
  label: string;
  disabled?: boolean;
  widthClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - MENU_GAP - VIEWPORT_MARGIN;
    const above = rect.top - MENU_GAP - VIEWPORT_MARGIN;
    // Hang below unless that's genuinely cramped and there's more room above.
    const flip = below < MIN_MENU_HEIGHT && above > below;
    setPosition({
      left: rect.left,
      width: rect.width,
      ...(flip
        ? { bottom: window.innerHeight - rect.top + MENU_GAP }
        : { top: rect.bottom + MENU_GAP }),
      maxHeight: Math.max(MIN_MENU_HEIGHT, flip ? above : below),
    });
  }, []);

  // Re-measure while open: the modal behind this can scroll under it.
  useEffect(() => {
    if (!open) return;
    measure();
    const onMove = () => measure();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, measure]);

  // Fresh search each time it opens, and the box focused so you can just type.
  useEffect(() => {
    if (open) {
      setQuery("");
      searchRef.current?.focus();
    }
  }, [open]);

  // Click anywhere else closes it — including inside the modal behind.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q
    ? options.filter((o) => o.name.toLowerCase().includes(q))
    : options;
  const selected = options.find((o) => o.id === value) ?? null;

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className={`relative ${widthClass}`}>
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-1 rounded-lg border px-2.5 py-2 text-left text-base sm:text-sm
          disabled:cursor-not-allowed disabled:opacity-50
          ${
            open
              ? "border-indigo-500 ring-1 ring-indigo-500"
              : "border-gray-300 dark:border-gray-600"
          } bg-white dark:bg-gray-900`}
      >
        <span className={`truncate ${selected ? "" : "text-gray-400"}`}>
          {selected ? selected.name : placeholder}
        </span>
        <span aria-hidden className="shrink-0 text-gray-400">
          ▾
        </span>
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            style={{
              position: "fixed",
              left: position.left,
              width: Math.max(position.width, 224),
              top: position.top,
              bottom: position.bottom,
              maxHeight: position.maxHeight,
            }}
            className="z-[60] flex flex-col overflow-hidden rounded-lg border border-gray-200
              bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="border-b border-gray-100 p-1.5 dark:border-gray-700">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a name…"
                aria-label={`${label}: search`}
                // 16px on phones, or iOS zooms the page in on focus and never
                // zooms back out (see app/globals.css).
                className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-base
                  outline-none focus:border-indigo-500 sm:text-sm
                  dark:border-gray-600 dark:bg-gray-900"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    // Enter takes the first match — the reason to type at all.
                    e.preventDefault();
                    if (matches[0]) choose(matches[0].id);
                    return;
                  }
                  if (e.key === "Escape") {
                    // This control's Escape, not the modal's: every Modal
                    // closes on a document-level keydown, so without stopping
                    // it here, dismissing the list would close the dialog too.
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                  }
                }}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {matches.length === 0 && (
                <p className="px-3 py-2 text-sm text-gray-400">No one matches.</p>
              )}
              {matches.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  role="option"
                  aria-selected={o.id === value}
                  onClick={() => choose(o.id)}
                  className={`block w-full px-3 py-1.5 text-left text-sm transition-colors
                    hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      o.id === value
                        ? "font-medium text-indigo-700 dark:text-indigo-300"
                        : "text-gray-700 dark:text-gray-200"
                    }`}
                >
                  {o.name}
                  {/* The one Enter would take, so the shortcut is discoverable
                      rather than something you have to be told about. */}
                  {i === 0 && q !== "" && (
                    <span className="ml-2 text-[11px] text-gray-400">Enter</span>
                  )}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
