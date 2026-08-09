"use client";
// Click-to-open dropdown menu (used for the navbar user menu).
// Closes on outside click.
import { ReactNode, useEffect, useRef, useState } from "react";

interface DropdownProps {
  // What you click to open the menu. Pass a function to react to the open
  // state (e.g. an icon that animates open ⇄ closed).
  trigger: ReactNode | ((open: boolean) => ReactNode);
  children: ReactNode; // menu contents
  align?: "left" | "right";
  // Extra classes for the menu panel. Defaults to `overflow-hidden` (so item
  // hover backgrounds stay within the rounded corners); pass `overflow-visible`
  // when a child needs to escape the panel, e.g. a hover popover/tooltip.
  menuClassName?: string;
  // When true, the menu opens on hover (and closes when the pointer leaves the
  // trigger + panel area) instead of only on click. Click still toggles it, so
  // touch devices — which have no hover — keep working.
  hover?: boolean;
}

export default function Dropdown({
  trigger,
  children,
  align = "right",
  menuClassName = "overflow-hidden",
  hover = false,
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Hover mode opens/closes as the pointer enters/leaves the whole container.
  const hoverHandlers = hover
    ? {
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
      }
    : {};

  return (
    <div className="relative" ref={ref} {...hoverHandlers}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center">
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {open && (
        // The `pt-2` wrapper (rather than a margin on the panel) keeps the gap
        // below the trigger part of the hoverable area, so the pointer can
        // travel from trigger into the panel without dropping hover and closing.
        <div
          className={`absolute top-full z-40 pt-2 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <div
            // Clicks inside the menu (e.g. "Log out") close it too.
            onClick={() => setOpen(false)}
            className={`w-48 rounded-lg border border-gray-200 bg-white py-1
              shadow-lg dark:border-gray-700 dark:bg-gray-800 ${menuClassName}`}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
