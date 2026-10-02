"use client";
// Tab-swipe gesture, wherever the app-style bottom bar is shown (phones and
// tablets — see lib/layout.ts).
//
// NOTHING MOVES — not the page, not the cue. Drag clearly sideways and a small
// arrow disc fades up on the side you're heading for, deepening from pale to
// solid indigo as you go; release once it's fully dark and you land on that
// tab, let go short and it fades away. Opacity is the whole animation, so
// there's exactly one thing to read: dark = you'll land.
//
// That's deliberate. The previous version translated the content with your
// finger, so a vertical scroll that drifted a few degrees off-axis shoved the
// page sideways and you had to drag it back. Here a misread gesture costs a
// faint arrow nobody asked for, and nothing else.
//
// Not moving the page has a second payoff: no transform on this element means
// it never becomes the containing block for a `position: fixed` descendant, a
// hazard that used to mis-centre modals and full-page loaders mid-swipe.
//
// The thresholds and the axis test live in lib/swipeNav.ts (unit-tested).
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBottomNavWidth } from "@/lib/layout";
import { consumeNavDirection } from "@/lib/navDirection";
import { gestureAxis, shouldCommit, swipeProgress, swipeTarget } from "@/lib/swipeNav";
import { useSwipe } from "./SwipeProvider";

// useLayoutEffect warns during SSR; fall back to useEffect on the server (the
// pre-paint positioning it buys us only matters on the client anyway).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const IN_MS = 250; // the new page fading in after a committed swipe
const CUE_FADE_MS = 160; // the cue fading out when you let go
const CUE_INSET = 16; // px the cue floats in from the screen edge

// The cue is two identical discs stacked: a plain one, and the armed indigo
// one over it. Fading the top disc in by the same `progress` ripens the COLOUR
// along with the opacity — one continuous "getting warmer", rather than a
// grey disc that snaps to indigo at the threshold. Two layers of Tailwind
// beats interpolating hex in JS, which would have to re-derive both themes.
const DISC_BASE =
  "flex h-12 w-12 items-center justify-center rounded-full shadow-lg ring-1";
const DISC_IDLE =
  "bg-white text-gray-400 ring-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-700";
const DISC_ARMED =
  "bg-indigo-600 text-white ring-indigo-600 dark:bg-indigo-500 dark:ring-indigo-500";

// A plain chevron pointing at the tab you're heading for (the whole disc is
// mirrored for the left-hand one).
function Arrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

export default function SwipePager({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabsRef, activeIndexRef, navigateRef, setPreviewIndex } = useSwipe();
  const elRef = useRef<HTMLDivElement>(null);
  // The cue. Driven imperatively (inline styles) rather than by state: it
  // updates on every touchmove, and re-rendering the whole page subtree at
  // 60fps to fade one disc would be absurd.
  const cueRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const armedRef = useRef<HTMLDivElement>(null);
  // Portals need a DOM to render into, which the server hasn't got.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // On a committed swipe, land the new route with a quick fade. (It's a fade
  // and not a slide because a transform here would capture `position: fixed`
  // descendants — a route-level loader or a modal — and drag the "full-page"
  // overlay around with it.) Runs before paint so nothing flashes.
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    setPreviewIndex(null); // the real active tab is authoritative again
    if (consumeNavDirection() === 0) {
      el.style.transition = "";
      el.style.opacity = "";
      return;
    }
    el.style.transition = "none";
    el.style.opacity = "0";
    void el.offsetWidth; // force the start state to stick before animating
    el.style.transition = `opacity ${IN_MS}ms ease-out`;
    el.style.opacity = "1";
  }, [pathname, setPreviewIndex]);

  // The gesture. Attaches once (all deps are stable refs/setters) and reads
  // live tab info from the shared refs, so it never goes stale.
  useIsoLayoutEffect(() => {
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let mode: "none" | "deciding" | "drag" = "none";
    let dx = 0;
    let target: number | null = null;
    let preview: number | null = null;
    // Bumped every time the cue is painted, so a hide scheduled by an earlier
    // gesture knows it has been overtaken and leaves the new one alone.
    let cueSeq = 0;

    // Paint the cue for the current drag. `progress` is literally its opacity
    // — and the armed disc's, so it darkens into indigo as it appears.
    const showCue = (progress: number, toLeft: boolean) => {
      const cue = cueRef.current;
      if (!cue) return;
      cueSeq++;
      // Mirrored rather than rotated for the left-hand tab: a disc is round,
      // so only the arrow inside it can tell, and flipping keeps the drop
      // shadow pointing down where light comes from.
      if (stackRef.current) {
        stackRef.current.style.transform = toLeft ? "scaleX(-1)" : "";
      }
      if (armedRef.current) armedRef.current.style.opacity = String(progress);
      // It sits on the destination's side but floats clear of the edge, and
      // it never moves: fading from nothing to solid indigo is the ENTIRE
      // animation, so "fully dark = let go now" is the one thing to read. A
      // disc that also slid in gave the same fact twice and made the edge of
      // the screen look draggable, which is what this gesture no longer is.
      cue.style.left = toLeft ? `${CUE_INSET}px` : "auto";
      cue.style.right = toLeft ? "auto" : `${CUE_INSET}px`;
      cue.style.display = "block";
      cue.style.transition = "none";
      cue.style.opacity = String(progress);
    };

    // Fade it out and park it. Hidden with `display: none` once gone so a
    // stray tap can never find it (it's pointer-events-none either way).
    const hideCue = () => {
      const cue = cueRef.current;
      if (!cue || cue.style.display === "none") return;
      cue.style.transition = `opacity ${CUE_FADE_MS}ms ease-out`;
      cue.style.opacity = "0";
      window.setTimeout(() => {
        if (cue.style.opacity === "0") cue.style.display = "none";
      }, CUE_FADE_MS);
    };

    const clear = () => {
      mode = "none";
      dx = 0;
      target = null;
      if (preview !== null) {
        preview = null;
        setPreviewIndex(null);
      }
    };

    // A touch that starts inside something that scrolls sideways (a filmstrip,
    // a wide table) belongs to that thing — its scroll IS the intended
    // horizontal gesture here.
    const inHorizontalScroller = (node: EventTarget | null) => {
      let el = node instanceof Element ? node : null;
      while (el && el !== document.body) {
        if (el.scrollWidth > el.clientWidth + 1) {
          const overflow = getComputedStyle(el).overflowX;
          if (overflow === "auto" || overflow === "scroll") return true;
        }
        el = el.parentElement;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      clear();
      // Only where the app-style bottom bar is: swiping between tabs pairs
      // with that bar, so the two share one width (lib/layout.ts).
      if (e.touches.length !== 1 || !isBottomNavWidth()) return;
      const p = window.location.pathname;
      if (p === "/login" || p === "/join") return; // no tabs on auth pages
      // Don't hijack touches while a dialog is open — its own scroll and
      // controls should win.
      if (document.querySelector('[role="dialog"]')) return;
      if (inHorizontalScroller(e.target)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
      mode = "deciding";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      if (mode === "deciding") {
        const axis = gestureAxis(mx, my);
        if (axis === "undecided") return;
        // Vertical wins → hand the touch back to the page for good. `clear()`
        // sets mode to "none", and nothing re-opens it until the next
        // touchstart, so a scroll that wanders sideways halfway down stays a
        // scroll.
        if (axis === "vertical") {
          clear();
          return;
        }
        mode = "drag";
      }
      // We own this gesture now — stop the browser scrolling underneath us or
      // firing its own back/forward swipe.
      if (e.cancelable) e.preventDefault();
      dx = mx;
      const w = window.innerWidth || 1;
      target = swipeTarget(activeIndexRef.current, dx, tabsRef.current.length);
      // Nothing that way: stay silent (no cue, no rubber-band) but keep
      // swallowing the gesture, so the native edge swipe can't fire either.
      if (target === null) {
        hideCue();
        return;
      }
      const progress = swipeProgress(dx, w);
      showCue(progress, dx > 0);
      // Only once it's armed does the bottom bar preview the destination —
      // the highlight and the solid pill say the same thing at the same time.
      const next = progress >= 1 ? target : null;
      if (next !== preview) {
        preview = next;
        setPreviewIndex(next);
      }
    };

    const onEnd = () => {
      if (mode !== "drag") {
        clear();
        return;
      }
      const commit =
        target !== null &&
        shouldCommit(swipeProgress(dx, window.innerWidth || 1), Date.now() - startT);
      if (commit) {
        const toIndex = target as number;
        const href = tabsRef.current[toIndex];
        // Keep the destination highlighted through the navigation, and leave
        // the cue up (solid) while the new page fades in — it's the only
        // feedback between the release and the route change.
        setPreviewIndex(toIndex);
        preview = toIndex;
        showCue(1, dx > 0);
        const mine = cueSeq;
        window.setTimeout(() => {
          if (cueSeq === mine) hideCue();
        }, IN_MS);
        // The incoming route mounts at the top; match it so the new tab isn't
        // scrolled to a position that belonged to the old one.
        window.scrollTo(0, 0);
        mode = "none";
        dx = 0;
        target = null;
        if (href) navigateRef.current(href);
        return;
      }
      hideCue();
      clear();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so onMove can preventDefault once it locks into a swipe.
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [tabsRef, activeIndexRef, navigateRef, setPreviewIndex]);

  // Portaled to <body> so no transformed ancestor (pull-to-refresh mid-pull,
  // say) can re-anchor this `fixed` box.
  const cue =
    mounted &&
    createPortal(
      <div
        ref={cueRef}
        aria-hidden
        data-testid="swipe-cue"
        className="pointer-events-none fixed top-1/2 z-40 -translate-y-1/2"
        style={{ display: "none", opacity: 0 }}
      >
        {/* Both discs are the same box, the armed one laid exactly over the
            plain one — so fading it in blends the two colours instead of
            swapping them. */}
        <div ref={stackRef} className="relative">
          <div className={`${DISC_BASE} ${DISC_IDLE}`}>
            <Arrow />
          </div>
          <div
            ref={armedRef}
            className={`absolute inset-0 ${DISC_BASE} ${DISC_ARMED}`}
            style={{ opacity: 0 }}
          >
            <Arrow />
          </div>
        </div>
      </div>,
      document.body
    );

  // `overflow-x: clip` guards the page against any content that's wider than
  // the viewport: a horizontally-scrolled page slides the `fixed` nav bars out
  // of view with it (iOS anchors fixed boxes to the document's left edge), and
  // it's exactly the sideways drift this gesture is meant to rule out.
  // Paired with the default `overflow-y: visible`, so no scroll container is
  // created and `position: sticky` inside pages keeps working.
  return (
    <>
      <div ref={elRef} className="overflow-x-clip">
        {children}
      </div>
      {cue}
    </>
  );
}
