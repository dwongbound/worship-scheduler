"use client";
// Click-to-open dropdown menu (used for the navbar user menu and the set-detail
// overflow menu). Closes on outside click. In `hover` mode the menu also opens
// on hover, but a click latches it open until you click again — see `latched`.
//
// The menu renders in a PORTAL on document.body, positioned with fixed
// coordinates measured from the trigger. It has to: inside a modal the menu's
// ancestors are `overflow-hidden` (the panel) and `overflow-y-auto` (the body),
// either of which would clip it — a menu that opens near the bottom of a modal
// would be cut off with no way to reach its items. At body level nothing clips
// it, and a z-index above the modal's keeps it on top of the backdrop too.
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

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

// Where the portaled panel sits: always pinned under the trigger, anchored by
// whichever edge `align` names.
interface MenuPosition {
  top: number;
  left?: number;
  right?: number;
}

// How long the menu survives the pointer leaving it, in hover mode. The trigger
// and the panel are in different DOM trees now, so moving between them fires a
// real mouseleave; without this grace period the menu would close before the
// pointer ever arrived.
const HOVER_CLOSE_MS = 120;

export default function Dropdown({
  trigger,
  children,
  align = "right",
  menuClassName = "overflow-hidden",
  hover = false,
  widthClassName = "w-48",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // A click on the trigger LATCHES the menu open: hover alone should close as
  // soon as the pointer leaves, but a menu you deliberately clicked has to stay
  // put while you read it. A latched menu ignores mouseleave and closes on the
  // next trigger click, an outside click, or picking an item. (A ref, not
  // state — the deferred hover-close callback has to read the current value.)
  const latched = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close for good: drops the latch so the next click opens cleanly.
  const close = useCallback(() => {
    latched.current = false;
    setOpen(false);
  }, []);

  // Measure the trigger and pin the panel under it. Called on open and again
  // whenever anything moves the trigger under it.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPosition(
      align === "right"
        ? { top: rect.bottom, right: window.innerWidth - rect.right }
        : { top: rect.bottom, left: rect.left }
    );
  }, [align]);

  // Before paint, so the menu never flashes at a stale position.
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => measure();
    // Capture phase: the trigger may live inside a scrollable modal body, whose
    // scroll events don't bubble to window.
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is outside `ref`'s subtree now, so it needs its own check —
      // otherwise every click inside the menu would read as an outside click.
      if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) {
        close();
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, close]);

  // Never leave a close pending after unmount.
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    []
  );

  // Hover mode opens/closes as the pointer enters/leaves either the trigger or
  // the panel; the delay bridges the gap between the two.
  const hoverHandlers = hover
    ? {
        onMouseEnter: () => {
          if (closeTimer.current) clearTimeout(closeTimer.current);
          setOpen(true);
        },
        onMouseLeave: () => {
          if (latched.current) return; // clicked open — hover can't close it
          if (closeTimer.current) clearTimeout(closeTimer.current);
          closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
        },
      }
    : {};

  // Clicking the trigger toggles the LATCH, not just the open state: a click
  // pins the menu open (even when hover had already opened it, which is the
  // usual order — mouseenter fires before click), and the next click closes it.
  const onTriggerClick = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (latched.current) {
      close();
      return;
    }
    latched.current = true;
    setOpen(true);
  };

  const menu =
    open && position ? (
      // The `pt-2` (rather than a margin) keeps the gap below the trigger part
      // of the hoverable area, so the pointer can travel from trigger into the
      // panel without crossing dead space.
      <div
        ref={menuRef}
        style={{ top: position.top, left: position.left, right: position.right }}
        className="fixed z-[60] pt-2"
        {...hoverHandlers}
      >
        <div
          // Clicks inside the menu (e.g. "Log out") close it too.
          onClick={close}
          className={`${widthClassName} rounded-lg border border-gray-200 bg-white py-1
            shadow-lg dark:border-gray-700 dark:bg-gray-800 ${menuClassName}`}
        >
          {children}
        </div>
      </div>
    ) : null;

  return (
    <div className="relative" ref={ref} {...hoverHandlers}>
      <button onClick={onTriggerClick} className="flex items-center">
        {typeof trigger === "function" ? trigger(open) : trigger}
      </button>
      {menu && typeof document !== "undefined"
        ? createPortal(menu, document.body)
        : null}
    </div>
  );
}
