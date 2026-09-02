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
  // Usually a string, but any node works — CreateSetModal passes an input so
  // the heading itself is the set's name.
  title: ReactNode;
  // Optional muted text rendered inline after the title (e.g. a set's date).
  subtitle?: ReactNode;
  // Optional element pinned to the right of the title itself (e.g. an org
  // chip), center-aligned with it rather than dropping to the subtitle line.
  titleAccessory?: ReactNode;
  children: ReactNode;
  // Panel width. "lg" (default) is the standard centered dialog; "xl" is the
  // roomier dialog for content-heavy views (e.g. a set's roster + setlist);
  // "full" is a near-full-screen workspace for review/editing flows (e.g. the
  // staged schedule) where a single narrow column would be hard to scan.
  size?: "lg" | "xl" | "full";
  // Optional action bar pinned to the bottom of the panel, outside the scroll
  // area (e.g. Apply / Discard). Buttons here stay put while the body scrolls.
  footer?: ReactNode;
}

// Panel classes per size. "full" trades the centered card for a tall, wide
// workspace: no width cap at all, so it stretches to the viewport minus the
// thin margin below — just enough for the backdrop to still read as a modal.
const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  lg: "max-w-lg max-h-[85vh]",
  xl: "max-w-3xl max-h-[88vh]",
  full: "max-w-none h-[96vh]",
};

// ── Background scroll lock ────────────────────────────────────────────────
// Shared by every Modal, because more than one is open at a time all the time
// (a confirm dialog over a workspace, the roles editor over a set).
//
// Each modal remembering the body's PREVIOUS overflow and restoring it on the
// way out looks right and isn't: with two open, the second saw "hidden" on the
// way in, so whichever unmounts LAST writes "hidden" back — with nothing open.
// The page is then unscrollable until a reload. A count fixes the ordering: the
// first lock records the real value, and only the last release restores it.
let lockCount = 0;
let overflowBeforeLock = "";

// Locks background scrolling and returns the release. Safe to call twice (React
// StrictMode double-invokes effects) — a release only counts once.
function lockBodyScroll(): () => void {
  if (lockCount === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount--;
    if (lockCount <= 0) {
      lockCount = 0;
      document.body.style.overflow = overflowBeforeLock;
    }
  };
}

// Gap between the panel and the viewport edge. "full" wants nearly all of the
// screen, so its margin is a hairline compared to a centered dialog's.
const PADDING_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  lg: "p-4",
  xl: "p-4",
  full: "p-2 sm:p-3",
};

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  titleAccessory,
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

  // Lock background scrolling while the modal is open. Counted across every
  // open modal (see lockBodyScroll) so closing them in any order — including
  // the underlying one first — always leaves the page scrollable.
  useEffect(() => {
    if (!open) return;
    return lockBodyScroll();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${PADDING_CLASSES[size]}`}
    >
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
            {/* Title + accessory (org chip, lock). On phones the accessory
                wraps to its own line under the title instead of squeezing it;
                on ≥sm they share a line. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:flex-nowrap">
              <h2 className="text-lg font-semibold">{title}</h2>
              {titleAccessory}
            </div>
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
