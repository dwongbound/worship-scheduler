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
  // Tailwind width class for the menu panel. Widen it when an item's label
  // would otherwise wrap onto a second line.
  widthClassName?: string;
}

export default function Dropdown({
  trigger,
  children,
  align = "right",
  menuClassName = "overflow-hidden",
  hover = false,
  widthClassName = "w-48",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Hover mode only: set when the pointer entering the trigger is what opened
  // the menu, so the click that follows in the SAME interaction doesn't toggle
  // it straight back shut. Both a mouse click and a touch tap fire mouseenter
  // before click, so without this the menu opened and closed in one gesture and
  // could never be opened by clicking at all.
  const openedByHover = useRef(false);

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
        onMouseEnter: () => {
          openedByHover.current = true;
          setOpen(true);
        },
        onMouseLeave: () => {
          openedByHover.current = false;
          setOpen(false);
        },
      }
    : {};

  // Clicking the trigger toggles the menu — except for the click that lands
  // right after hover already opened it, which is a no-op. Once that first
  // click is spent, further clicks (with the pointer still on the trigger)
  // toggle normally, so the trigger closes the menu again.
  const onTriggerClick = () => {
    if (openedByHover.current) {
      openedByHover.current = false;
      return;
    }
    setOpen((o) => !o);
  };

  return (
    <div className="relative" ref={ref} {...hoverHandlers}>
      <button onClick={onTriggerClick} className="flex items-center">
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
            className={`${widthClassName} rounded-lg border border-gray-200 bg-white py-1
              shadow-lg dark:border-gray-700 dark:bg-gray-800 ${menuClassName}`}
          >
            {children}
          </div>
        </div>
      )}
    </div>
  );
}
