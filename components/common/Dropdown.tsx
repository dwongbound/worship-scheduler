"use client";
// Click-to-open dropdown menu (used for the navbar user menu).
// Closes on outside click.
import { ReactNode, useEffect, useRef, useState } from "react";

interface DropdownProps {
  trigger: ReactNode; // what you click to open the menu
  children: ReactNode; // menu contents
  align?: "left" | "right";
}

export default function Dropdown({
  trigger,
  children,
  align = "right",
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

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center">
        {trigger}
      </button>
      {open && (
        <div
          // Clicks inside the menu (e.g. "Log out") close it too.
          onClick={() => setOpen(false)}
          className={`absolute top-full z-40 mt-2 w-48 overflow-hidden rounded-lg border
            border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800
            ${align === "right" ? "right-0" : "left-0"}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}
