"use client";
// Reusable modal: overlay click or Escape closes it.
//
// Layout is a flex column — a fixed header, a scrollable body, and an optional
// fixed footer that never scrolls with (or gets overlapped by) the body. This
// matters for the tall "full" workspace, where a sticky-inside-a-scrollbox
// footer would leave a gap the body content peeks through.
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  // Panel width. "lg" (default) is the standard centered dialog; "wide" is a
  // step up for dialogs whose lines would otherwise wrap (e.g. a list of
  // recurring sets with their day, time and team); "xl" is the roomier dialog
  // for content-heavy views (e.g. a set's roster + setlist);
  // "full" is a near-full-screen workspace for review/editing flows (e.g. the
  // staged schedule) where a single narrow column would be hard to scan.
  size?: "lg" | "wide" | "xl" | "full";
  // Optional action bar pinned to the bottom of the panel, outside the scroll
  // area (e.g. Apply / Discard). Buttons here stay put while the body scrolls.
  //
  // Pass a FUNCTION instead of a node to have it told whether the body has been
  // read to the end — `atEnd` is true once the scroll box is at its bottom, and
  // true from the start when there's nothing to scroll. It's how a confirm
  // action waits for a long summary to actually be seen (see the availability
  // page's submit dialog) without punishing the short case.
  footer?: ReactNode | ((state: { atEnd: boolean }) => ReactNode);
  // Optional controls in the HEADER, to the left of the ✕ — for a switch that
  // reframes the whole body rather than acting on part of it (the staged
  // schedule's grouping toggle). They stay put while the body scrolls, which
  // is the point: in a tall workspace a control parked at the top of the
  // scroll area is gone the moment you start reading.
  headerActions?: ReactNode;
}

// Panel classes per size. "full" trades the centered card for a tall, wide
// workspace: no width cap at all, so it stretches to the viewport minus the
// thin margin below — just enough for the backdrop to still read as a modal.
const SIZE_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  // dvh, not vh: on iOS Safari `vh` is the height with the toolbar HIDDEN, so
  // while it shows, a vh-sized panel runs under it and its footer buttons end
  // up against the bottom edge. `full` fills the overlay's padded box, which
  // already keeps clear of the screen edges and the safe area.
  lg: "max-w-lg max-h-[85dvh]",
  wide: "max-w-2xl max-h-[85dvh]",
  xl: "max-w-3xl max-h-[88dvh]",
  full: "max-w-none h-full",
};

// useLayoutEffect warns when React renders this on the server; fall back to
// useEffect there (the pre-paint measurement it buys us is client-only anyway).
// The same shim SwipePager uses.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

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
// Every side also stays out of the device's safe area (notch, home indicator,
// the landscape cut-outs); env() is 0 where there is none, leaving the plain
// padding. Spelled out in full rather than built from a template, because
// Tailwind only generates classes it can read literally in the source.
const SAFE_1REM =
  "pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] " +
  "pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]";
const PADDING_CLASSES: Record<NonNullable<ModalProps["size"]>, string> = {
  lg: SAFE_1REM,
  wide: SAFE_1REM,
  xl: SAFE_1REM,
  full:
    "pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] " +
    "pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]",
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
  headerActions,
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

  // Has the body been scrolled to its end? Only tracked for a footer that asked
  // (the function form) — every other modal pays nothing for this.
  const bodyRef = useRef<HTMLDivElement>(null);
  const gated = typeof footer === "function";
  const [atEnd, setAtEnd] = useState(true);

  // Measured after every render rather than on scroll alone: the content can
  // change height under us (a list filtering down, an error appearing) and
  // that shouldn't leave the footer waiting for a scroll that's no longer
  // possible. Before paint, so the footer never flashes the wrong state.
  useIsoLayoutEffect(() => {
    if (!open || !gated) return;
    const el = bodyRef.current;
    if (!el) return;
    // 1px of slack: fractional layout means scrollTop can land just shy of the
    // bottom even when the box is visibly scrolled all the way down.
    const measure = () =>
      setAtEnd(el.scrollHeight - el.scrollTop - el.clientHeight <= 1);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    // Catches the panel being resized (rotation, a phone keyboard opening)
    // without a scroll or a re-render to go with it.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  });

  if (!open) return null;

  // Rendered into <body>, the way Dropdown/Toast/PlayerSelect do it, so the
  // dialog is centered on the SCREEN rather than inside whatever the page
  // happens to be. `position: fixed` is only relative to the viewport while no
  // ancestor has a transform (or filter, or will-change) — and this app has
  // two that come and go under the content: the tab-swipe pager and
  // pull-to-refresh. Left in the tree, a modal opened at the wrong moment
  // centers itself in that box instead, with a backdrop that covers only it.
  const overlay = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center ${PADDING_CLASSES[size]}`}
    >
      {/* backdrop. touch-none: a swipe on the dimmed area would otherwise
          scroll the page underneath on iOS, which ignores the body lock. */}
      <div
        className="absolute inset-0 touch-none bg-black/50"
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
        <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6">
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
          {/* shrink-0 on the pair: the title is what gives way on a narrow
              panel, never the controls. */}
          <div className="flex shrink-0 items-center gap-3">
            {headerActions}
            {/* A drawn X rather than the "✕" glyph: the glyph rendered as a
                hairline in Figtree, and its tiny box was hard to hit on a
                phone. 44px square target on phones (40px from sm up); the glyph
                itself stays 18px at a 2.25 stroke, about the weight of the title,
                so the bigger target doesn't read as a bigger button. The
                negative TOP margin lets the bigger box reach up into the
                header's padding instead of pushing the header taller — top
                only, because a box that also hangs out the bottom makes this
                row overflow (and look scrollable to anything measuring it). */}
            <button
              onClick={onClose}
              aria-label="Close"
              className="-mr-2 -mt-2.5 flex h-11 w-11 items-center justify-center sm:-mt-2 sm:h-10 sm:w-10 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        {/* min-h-0 lets this flex child actually shrink so it (not the panel)
            scrolls. The 4px of `pt` is borrowed from the header's `pb` (the gap
            below the title is unchanged at 12px): this is a scroll container,
            so it clips at its own edge, and with no top padding a first child's
            focus ring — a textarea's, say — lost its top edge. */}
        {/* overscroll-contain: reaching the end of the body stops there instead
            of handing the swipe to the page behind (the body-overflow lock
            below isn't enough on iOS Safari, which scrolls it anyway). */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-6 pt-1">
          {children}
        </div>

        {footer && (
          // `modal-footer` is what globals.css hooks for the phone layout:
          // its buttons share the row in equal widths at a 44px height, so
          // none is left alone in the panel's bottom-right corner — which on an
          // iPhone is where the screen itself curves away.
          <div className="modal-footer flex items-center justify-end gap-2 border-t border-gray-200 px-4 pb-4 pt-3 dark:border-gray-700 sm:px-6 sm:py-3">
            {typeof footer === "function" ? footer({ atEnd }) : footer}
          </div>
        )}
      </div>
    </div>
  );

  // No document during SSR; the portal is a client-only concern (an open modal
  // renders nothing on the server, and a portal contributes no nodes here, so
  // hydration sees the same empty slot either way).
  return typeof document === "undefined"
    ? null
    : createPortal(overlay, document.body);
}
