"use client";
// A colour swatch you click to open a small hex picker. Used to tint one
// recurring set in the generate preview, so "none" (no tint at all) is a real
// value and the default — the swatch shows a diagonal slash when it's unset.
//
// The panel is PORTALED to document.body and positioned with fixed coordinates
// measured from the swatch, for the same reason Dropdown is: it opens inside a
// modal whose body scrolls (`overflow-y-auto`) and whose panel clips
// (`overflow-hidden`), either of which would cut it off. Unlike Dropdown it
// doesn't close on EVERY inside click — there's a text field in here to type
// in — but picking a colour (a preset, "No color", or Enter on a valid hex) is
// the end of the job, so that closes it.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { normalizeHex } from "@/lib/colors";

// Starting palettes: ten hues far enough apart that a dozen set types stay
// tellable at a glance. They differ per theme because the tint they produce
// has to show up on the card it lands on — pale pastels vanish on a dark card,
// and the brighter set is garish on a white one. Typing a hex isn't limited to
// either list.
const LIGHT_PRESETS = [
  "#fecaca", // red
  "#fed7aa", // orange
  "#fef08a", // yellow
  "#d9f99d", // lime
  "#bbf7d0", // green
  "#a5f3fc", // cyan
  "#bfdbfe", // blue
  "#ddd6fe", // violet
  "#fbcfe8", // pink
  "#e5e7eb", // gray
];
const DARK_PRESETS = [
  "#f87171", // red
  "#fb923c", // orange
  "#facc15", // yellow
  "#a3e635", // lime
  "#4ade80", // green
  "#22d3ee", // cyan
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#f472b6", // pink
  "#94a3b8", // gray
];

/**
 * Whether the app is rendering dark right now. There's no theme context (the
 * Navbar owns the toggle and writes Tailwind's `dark` class straight onto
 * <html>), so watch that class — it covers the toggle, an OS change in
 * "system" mode, and the pre-hydration script alike.
 */
function useIsDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setDark(root.classList.contains("dark"));
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

// The "no colour" swatch: a thin diagonal line corner to corner.
const NO_COLOR_SLASH =
  "linear-gradient(to top right, transparent calc(50% - 1px), " +
  "#9ca3af calc(50% - 1px), #9ca3af calc(50% + 1px), transparent calc(50% + 1px))";

export default function ColorPicker({
  value,
  onChange,
  label = "Pick a color",
}: {
  value: string | null; // "#rrggbb", or null for no colour
  onChange: (next: string | null) => void;
  label?: string; // accessible name for the swatch button
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  // What's in the hex field. Kept as raw text so a half-typed "#a1b" doesn't
  // fight the caret; it only reaches `onChange` once it parses.
  const [draft, setDraft] = useState(value ?? "");
  const presets = useIsDark() ? DARK_PRESETS : LIGHT_PRESETS;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Follow the outside value (e.g. a preset click, or a reset when the dialog
  // reopens) while the field isn't being typed in.
  useEffect(() => {
    if (!open) setDraft(value ?? "");
  }, [open, value]);

  const measure = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => measure();
    // Capture phase: the swatch sits in a scrollable modal body, whose scroll
    // events never reach window by bubbling.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    // Escape closes the picker without touching the modal behind it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, measure]);

  // Picking is the whole point of the panel, so it closes on the way out.
  const pick = (hex: string | null) => {
    setDraft(hex ?? "");
    onChange(hex);
    setOpen(false);
  };

  // Typing: keep the hex characters, and commit as soon as the text is a real
  // colour so the swatch tracks what you type. The panel STAYS open — you may
  // still be typing — until Enter says you're done.
  const typeHex = (raw: string) => {
    const cleaned = "#" + raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 6);
    setDraft(cleaned);
    const parsed = normalizeHex(cleaned);
    if (parsed) onChange(parsed);
    else if (cleaned === "#") onChange(null); // cleared the field = no colour
  };

  const panel =
    open && position ? (
      <div
        ref={panelRef}
        style={{ top: position.top, right: position.right }}
        className="fixed z-[60] w-56 rounded-lg border border-gray-200 bg-white p-3
          shadow-lg dark:border-gray-700 dark:bg-gray-800"
      >
        <div className="grid grid-cols-5 gap-2">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              aria-label={preset}
              onClick={() => pick(preset)}
              style={{ backgroundColor: preset }}
              className={`h-6 w-full rounded border ${
                value === preset
                  ? "border-gray-900 ring-2 ring-indigo-500 dark:border-white"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            />
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            aria-hidden
            style={
              value
                ? { backgroundColor: value }
                : { backgroundImage: NO_COLOR_SLASH }
            }
            className="h-7 w-7 shrink-0 rounded border border-gray-300 dark:border-gray-600"
          />
          <input
            value={draft}
            onChange={(e) => typeHex(e.target.value)}
            placeholder="#aabbcc"
            spellCheck={false}
            aria-label="Hex color"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              const parsed = normalizeHex(draft);
              if (parsed) pick(parsed);
            }}
            className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1 font-mono
              text-sm focus:border-indigo-500 focus:outline-none focus:ring-1
              focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
          />
        </div>

        <button
          type="button"
          onClick={() => pick(null)}
          className="mt-2 w-full rounded-lg border border-gray-300 px-2 py-1 text-xs
            font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-600
            dark:text-gray-300 dark:hover:bg-gray-700"
        >
          No color
        </button>
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value ? `Color ${value}` : "No color"}
        aria-label={label}
        // Unset reads as an empty swatch with a diagonal slash through it, the
        // way "no fill" is drawn in a drawing app. Inline rather than a
        // Tailwind arbitrary value — the gradient is too long to read there.
        style={
          value
            ? { backgroundColor: value }
            : { backgroundImage: NO_COLOR_SLASH }
        }
        className="h-6 w-6 shrink-0 rounded border border-gray-300 dark:border-gray-500"
      />
      {panel && typeof document !== "undefined"
        ? createPortal(panel, document.body)
        : null}
    </>
  );
}
