"use client";
// Reusable modal: overlay click or Escape closes it.
//
// Layout is a flex column — a fixed header, a scrollable body, and an optional
// fixed footer that never scrolls with (or gets overlapped by) the body. This
// matters for the tall "full" workspace, where a sticky-inside-a-scrollbox
// footer would leave a gap the body content peeks through.
import { ReactNode, useEffect } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  // Optional muted text rendered inline after the title (e.g. a set's date).
  subtitle?: ReactNode;
  children: ReactNode;
  // Panel width. "lg" (default) is the standard centered dialog; "full" is a
  // near-full-screen workspace for review/editing flows (e.g. the staged
  // schedule) where a single narrow column would be hard to scan.
  size?: "lg" | "full";
  // Optional action bar pinned to the bottom of the panel, outside the scroll
  // area (e.g. Apply / Discard). Buttons here stay put while the body scrolls.
  footer?: ReactNode;
}

// Panel classes per size. "full" trades the centered card for a tall, wide
// workspace but keeps a small margin so the backdrop still reads as a modal.
const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  lg: "max-w-lg max-h-[85vh]",
  full: "max-w-6xl h-[92vh]",
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "lg",
  footer,
}: ModalProps) {
  // Close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock background scrolling while the modal is open (restore the previous
  // value on close so nested/stacked modals don't clobber each other).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        aria-hidden
      />
      {/* panel: fixed header, scrollable body, optional fixed footer */}
      <div
        role="dialog"
        aria-modal="true"
        className={`relative flex w-full flex-col overflow-hidden rounded-xl
          bg-white shadow-xl dark:bg-gray-800 ${SIZE_CLASSES[size]}`}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
          {/* Title with the optional subtitle inline (wraps under it when the
              panel is narrow). */}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h2 className="text-lg font-semibold">{title}</h2>
            {subtitle && (
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {subtitle}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            ✕
          </button>
        </div>

        {/* min-h-0 lets this flex child actually shrink so it (not the panel)
            scrolls. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-6 py-3 dark:border-gray-700">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
