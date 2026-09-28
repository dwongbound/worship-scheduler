"use client";
// Touch-width pull-to-refresh (phones and tablets, the same widths that get the
// bottom nav bar). Drag down from the top of a page and the content
// follows your finger with a spinner tucked above it; let go past the threshold
// and the tab reloads its data.
//
// What "reload" means is up to the page: a client page registers its own
// refetch with `usePullToRefresh(reload)`, which is instant and keeps you where
// you were. Anything that hasn't registered falls back to a real
// `location.reload()`, so the gesture always does something honest.
//
// Only the vertical half of the gesture is ours — a horizontal drag is the tab
// swipe (SwipePager), and the two never both engage: each locks in on the first
// decisive move and bails when the other axis wins.
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { isBottomNavWidth } from "@/lib/layout";

const START_SLOP = 10; // px of movement before we decide the gesture's axis
const THRESHOLD = 70; // px of pull that commits to a refresh
const REST = 48; // px the content holds at while refreshing
const MAX_PULL = 110; // px the content can be dragged, however hard you pull
const SNAP_MS = 250; // snap-back / settle animation
const MIN_SPIN_MS = 400; // keep the spinner up this long so it can't just blink

// The page's own refresh, shared through context so a page deep in the tree can
// register one. A ref (not state) so registering never re-renders the wrapper.
type RefreshRef = { current: (() => void | Promise<void>) | null };
const PullToRefreshContext = createContext<RefreshRef | null>(null);

/**
 * Register this page's refresh with the pull-to-refresh wrapper. Pass the same
 * `reload` the page already uses (a `useCallback`, so it stays stable); on
 * unmount the registration drops and the gesture falls back to a full reload.
 */
export function usePullToRefresh(refresh: () => void | Promise<void>) {
  const ref = useContext(PullToRefreshContext);
  useEffect(() => {
    if (!ref) return;
    ref.current = refresh;
    return () => {
      // Only clear it if it's still ours — a page that unmounts AFTER the next
      // one mounted must not wipe the newcomer's handler.
      if (ref.current === refresh) ref.current = null;
    };
  }, [ref, refresh]);
}

export default function PullToRefresh({ children }: { children: ReactNode }) {
  const refreshRef = useRef<(() => void | Promise<void>) | null>(null);
  // How far the content is pulled down, in px. Drives both the transform and
  // the spinner, so it's state rather than a ref.
  const [pull, setPull] = useState(0);
  // True only while a finger is dragging: the content tracks it with no
  // transition, and everything else (snap back, settle) animates.
  const [dragging, setDragging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Mirrors `refreshing` for the touch handlers, which are attached once and
  // would otherwise read a stale value.
  const refreshingRef = useRef(false);

  const runRefresh = useCallback(async () => {
    refreshingRef.current = true;
    setRefreshing(true);
    setPull(REST);
    try {
      const handler = refreshRef.current;
      // Nothing registered: the honest fallback is an actual page reload. It
      // never resolves — the document goes away — so we stop here.
      if (!handler) {
        window.location.reload();
        return;
      }
      // A cached refetch can finish in 20ms; hold the spinner a beat so the
      // gesture visibly did something.
      await Promise.all([
        handler(),
        new Promise((done) => window.setTimeout(done, MIN_SPIN_MS)),
      ]);
    } catch {
      // A failed refetch is the page's problem to report; ours is just to let
      // the spinner go.
    }
    refreshingRef.current = false;
    setRefreshing(false);
    setPull(0);
  }, []);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let mode: "none" | "deciding" | "pull" = "none";
    let distance = 0;

    const clear = () => {
      mode = "none";
      distance = 0;
    };

    const onStart = (e: TouchEvent) => {
      clear();
      if (e.touches.length !== 1 || !isBottomNavWidth()) return;
      if (refreshingRef.current) return;
      // Only from the very top of the page — mid-scroll, a downward drag is
      // scrolling.
      if (window.scrollY > 0) return;
      // A dialog runs its own scrolling; don't hijack touches inside one.
      if (document.querySelector('[role="dialog"]')) return;
      // Surfaces with their own drag gesture (e.g. the availability calendar's
      // paint-days grid) opt out with data-no-pull.
      const target = e.target;
      if (target instanceof Element && target.closest("[data-no-pull]")) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "deciding";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (mode === "deciding") {
        if (Math.abs(dx) < START_SLOP && Math.abs(dy) < START_SLOP) return;
        // Ours only if the move is downward AND more vertical than horizontal;
        // anything else belongs to the scroll or to the tab swipe.
        if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
          clear();
          return;
        }
        mode = "pull";
        setDragging(true);
      }
      // We own the gesture: stop the browser scrolling (or running its own
      // native pull-to-refresh) underneath us.
      if (e.cancelable) e.preventDefault();
      // Rubber-band: the pull gets heavier the further it goes, so it always
      // feels like it's resisting rather than hitting a wall.
      distance = Math.min(MAX_PULL, dy * 0.5);
      setPull(distance);
    };

    const onEnd = () => {
      if (mode !== "pull") {
        clear();
        return;
      }
      const committed = distance >= THRESHOLD;
      clear();
      setDragging(false);
      if (committed) runRefresh();
      else setPull(0);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so onMove can preventDefault once it's locked into a pull.
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [runRefresh]);

  // Past the threshold the spinner is "armed" — let go now and it refreshes.
  const armed = pull >= THRESHOLD;
  const active = pull > 0;

  return (
    <PullToRefreshContext.Provider value={refreshRef}>
      <div
        className="relative"
        style={{
          // Only transform while the gesture is live: a transformed ancestor
          // becomes the containing block for `position: fixed` children, which
          // would drag full-page modals and loaders around with it.
          transform: active ? `translateY(${pull}px)` : undefined,
          // No transition mid-drag (the content tracks the finger); animate the
          // snap back and the settle after a refresh.
          transition: dragging ? undefined : `transform ${SNAP_MS}ms ease-out`,
        }}
      >
        {/* The spinner sits just above the content, so it's dragged into view by
            the pull itself the way a native one is. Hidden entirely at rest so
            it can't be read by a screen reader or caught by a stray tap. */}
        {active && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-10 flex justify-center"
            style={{ opacity: Math.min(1, pull / THRESHOLD) }}
          >
            <span className="rounded-full bg-white p-2 shadow-md ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth={2}
                strokeLinecap="round"
                className={`h-5 w-5 ${
                  armed || refreshing
                    ? "text-indigo-600 dark:text-indigo-400"
                    : "text-gray-400"
                } ${refreshing ? "animate-spin" : ""}`}
                style={
                  // Before it's armed the icon turns with the pull, so the
                  // gesture reads as "keep going".
                  refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }
                }
              >
                {/* An open circle with an arrowhead — the usual refresh mark. */}
                <path
                  d="M20 12a8 8 0 1 1-2.34-5.66"
                  stroke="currentColor"
                />
                <path d="M20 4v4h-4" stroke="currentColor" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        )}
        {children}
      </div>
    </PullToRefreshContext.Provider>
  );
}
