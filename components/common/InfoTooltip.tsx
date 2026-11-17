"use client";
// Small "i" badge that reveals an explanatory tooltip on hover, keyboard
// focus, or tap. The bubble is rendered in a portal with fixed positioning off
// the icon's bounding rect, so it escapes any `overflow` scroll container it
// sits inside (e.g. a modal body or a dropdown) instead of being clipped by it.
// On touch (no hover) a tap opens it; tapping elsewhere or scrolling closes it.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function InfoTooltip({
  text,
  side = "top",
  variant = "info",
}: {
  // Accepts plain strings or JSX (e.g. <strong> to emphasize a phrase).
  text: ReactNode;
  // "info" is the grey "i". "warn" is a yellow "!", for a thing that is worth
  // noticing rather than merely worth knowing — a seat that breaks one of the
  // org's scheduling rules. Same bubble either way.
  variant?: "info" | "warn";
  // Where the bubble opens relative to the icon. "bottom" is handy when the
  // icon sits near the top of the viewport, where an upward bubble would be cut
  // off by the window edge.
  side?: "top" | "bottom";
}) {
  const iconRef = useRef<HTMLSpanElement>(null);
  // Fixed-position coordinates for the bubble, or null while hidden. We measure
  // on open so the portal (a document-level child) lines up with the icon.
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const show = () => {
    const el = iconRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Shrink the bubble on very narrow screens so it always fits the viewport.
    const MARGIN = 8; // min gap from either screen edge
    const width = Math.min(256, window.innerWidth - MARGIN * 2); // 256 = w-64
    // Anchor the bubble's right edge to the icon's right edge (the old
    // right-aligned look), then clamp so it never runs off a screen edge.
    let left = r.right - width;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - MARGIN - width));
    setPos({
      top: side === "top" ? r.top - 6 : r.bottom + 6,
      left,
      width,
    });
  };
  const hide = () => setPos(null);

  // Once open, a tap/click anywhere outside the icon or any scroll dismisses the
  // bubble. This is what makes tap-to-open usable on touch, where there's no
  // hover-out to close it. (Harmless for mouse users — they close by moving off.)
  useEffect(() => {
    if (!pos) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!iconRef.current?.contains(e.target as Node)) hide();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("scroll", hide, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", hide, true);
    };
  }, [pos]);

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
        aria-label={variant === "warn" ? "Why this is marked" : "More information"}
        // Tap opens on touch (where there's no hover); idempotent for mouse.
        onClick={show}
        className={`flex h-4 w-4 cursor-help select-none items-center justify-center
          rounded-full border text-[10px] font-semibold leading-none ${
            variant === "warn"
              ? "border-yellow-600 text-yellow-700 dark:border-yellow-400 dark:text-yellow-300"
              : "border-gray-400 text-gray-500 dark:border-gray-500 dark:text-gray-400"
          }`}
      >
        {variant === "warn" ? "!" : "i"}
      </span>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            // Fixed at the measured (clamped) left edge; translateY lifts an
            // upward bubble by its own height. z-index sits above modals (z-50).
            style={{
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: side === "top" ? "translateY(-100%)" : undefined,
            }}
            className="pointer-events-none fixed z-[60] rounded-md bg-gray-900
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
