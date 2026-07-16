"use client";
// Small "i" badge that reveals an explanatory tooltip on hover (or keyboard
// focus). The bubble is rendered in a portal with fixed positioning off the
// icon's bounding rect, so it escapes any `overflow` scroll container it sits
// inside (e.g. a modal body or a dropdown) instead of being clipped by it.
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function InfoTooltip({
  text,
  side = "top",
}: {
  text: string;
  // Where the bubble opens relative to the icon. "bottom" is handy when the
  // icon sits near the top of the viewport, where an upward bubble would be cut
  // off by the window edge.
  side?: "top" | "bottom";
}) {
  const iconRef = useRef<HTMLSpanElement>(null);
  // Fixed-position coordinates for the bubble, or null while hidden. We measure
  // on open so the portal (a document-level child) lines up with the icon.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    const el = iconRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Anchor the bubble's right edge to the icon's right edge (matching the old
    // right-aligned look) and open above or below by a small gap.
    setPos({
      top: side === "top" ? r.top - 6 : r.bottom + 6,
      left: r.right,
    });
  };
  const hide = () => setPos(null);

  return (
    <span
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <span
        ref={iconRef}
        tabIndex={0}
        aria-label="More information"
        className="flex h-4 w-4 cursor-help select-none items-center justify-center
          rounded-full border border-gray-400 text-[10px] font-semibold leading-none
          text-gray-500 dark:border-gray-500 dark:text-gray-400"
      >
        i
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            // Fixed + translate so the bubble's right edge and vertical anchor
            // land on the measured point. z-index sits above modals (z-50).
            style={{
              top: pos.top,
              left: pos.left,
              transform:
                side === "top"
                  ? "translate(-100%, -100%)"
                  : "translate(-100%, 0)",
            }}
            className="pointer-events-none fixed z-[60] w-64 rounded-md bg-gray-900
              px-3 py-2 text-xs font-normal normal-case text-gray-100 shadow-lg
              dark:bg-gray-700"
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  );
}
