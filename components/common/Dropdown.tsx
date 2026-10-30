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
//
// The portal alone doesn't make the menu VISIBLE, only unclipped: a panel hung
// off the trigger can still land past the edge of the window. Where it ends up
// is `lib/dropdownPosition.ts placeMenu`, which clamps it inside the viewport
// and flips it above the trigger when there's no room below.
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { placeMenu, type Placement } from "@/lib/dropdownPosition";

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

// How long the menu survives the pointer leaving it, in hover mode. The trigger
// and the panel are in different DOM trees now, so moving between them fires a
// real mouseleave; without this grace period the menu would close before the
// pointer ever arrived.
const HOVER_CLOSE_MS = 120;

// The gap between trigger and panel, as padding on the wrapper rather than a
// margin, so the pointer can cross it without leaving the hoverable area. It's
// part of the panel's footprint, so placeMenu has to be told about it.
const TRIGGER_GAP = 8;

export default function Dropdown({
  trigger,
  children,
  align = "right",
  menuClassName = "overflow-hidden",
  hover = false,
  widthClassName = "w-48",
}: DropdownProps) {
  const [open, setOpen] = useState(false);
  // Null until the panel has been measured. The panel is in the DOM before
  // then — it has to be, since its own size is half of where it goes — but
  // hidden, so it never flashes at an unplaced position.
  const [placement, setPlacement] = useState<Placement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // The panel itself, inside menuRef's wrapper: the box whose size decides
  // where the whole thing can go.
  const panelRef = useRef<HTMLDivElement>(null);
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
    setPlacement(null);
    setOpen(false);
  }, []);

  // Measure BOTH boxes — the trigger's position and the panel's own size — and
  // hand them to placeMenu. The panel's size is measured from its natural
  // layout, so this runs with maxHeight cleared (see the inline style below);
  // measuring a panel already capped to a scroll box would shrink it a little
  // more on every reposition.
  const measure = useCallback(() => {
    const el = ref.current;
    const panel = panelRef.current;
    if (!el || !panel) return;
    const trigger = el.getBoundingClientRect();
    setPlacement(
      placeMenu({
        trigger,
        menu: {
          width: panel.offsetWidth,
          // scrollHeight, not offsetHeight: once a cramped panel is capped to
          // a scroll box, its offset height IS the cap, so re-measuring would
          // ratchet it smaller. scrollHeight stays the content's full height.
          height: panel.scrollHeight + TRIGGER_GAP,
        },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        align,
      })
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

  const menu = open ? (
    // The gap is padding (rather than a margin) so it stays part of the
    // hoverable area and the pointer can travel from trigger into the panel
    // without crossing dead space. It sits on whichever side the trigger is on.
    <div
      ref={menuRef}
      style={{
        // Rendered before it has been placed so its size can be measured;
        // hidden until then, so it never flashes at the wrong coordinates.
        top: placement?.top ?? 0,
        left: placement?.left ?? 0,
        visibility: placement ? undefined : "hidden",
        paddingTop: placement?.above ? 0 : TRIGGER_GAP,
        paddingBottom: placement?.above ? TRIGGER_GAP : 0,
      }}
      className="fixed z-[60]"
      {...hoverHandlers}
    >
      <div
        ref={panelRef}
        // Clicks inside the menu (e.g. "Log out") close it too.
        onClick={close}
        // A panel too tall for either side of the trigger scrolls instead of
        // running off the screen. `overflow-y-auto` has to win over
        // menuClassName's `overflow-visible` (set where a row opens a
        // submenu), so it's applied inline and only when there's a cap.
        style={
          placement?.maxHeight === undefined
            ? undefined
            : { maxHeight: placement.maxHeight, overflowY: "auto" }
        }
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
