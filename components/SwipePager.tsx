"use client";
// Tab-swipe gesture, wherever the app-style bottom bar is shown (phones and
// tablets — see lib/layout.ts).
//
// The page NEVER moves. Drag clearly sideways and a small arrow cue fades in
// at the edge you're heading toward, naming the tab; pull it all the way (or
// flick) and release to go there, let go short and it fades away. That's the
// whole design, and it's deliberate: the previous version translated the
// content with your finger, so a vertical scroll that drifted a few degrees
// off-axis shoved the page sideways and you had to drag it back. Here a
// misread gesture costs an arrow nobody asked for, and nothing else.
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

// The cue's two looks. Armed = let go now and you'll land on that tab, so it
// goes solid indigo — the same "this is active" colour the nav bars use.
const PILL_BASE =
  "flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold shadow-lg ring-1";
const PILL_IDLE =
  "bg-white text-gray-500 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700";
const PILL_ARMED =
  "bg-indigo-600 text-white ring-indigo-600 dark:bg-indigo-500 dark:ring-indigo-500";

export default function SwipePager({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabsRef, activeIndexRef, navigateRef, setPreviewIndex } = useSwipe();
  const elRef = useRef<HTMLDivElement>(null);
  // The edge cue. Driven imperatively (style + textContent) rather than by
  // state: it updates on every touchmove, and re-rendering the whole page
  // subtree at 60fps to move one arrow would be absurd.
  const cueRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const arrowRef = useRef<SVGSVGElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
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

    // Paint the cue for the current drag. `progress` is literally its opacity:
    // invisible at rest, solid at a full pull.
    const showCue = (toIndex: number, progress: number, toLeft: boolean) => {
      const cue = cueRef.current;
      const pill = pillRef.current;
      if (!cue || !pill) return;
      cueSeq++;
      const tab = tabsRef.current[toIndex];
      if (labelRef.current) labelRef.current.textContent = tab?.label ?? "";
      const armed = progress >= 1;
      // Heading left, the arrow leads ("← Calendar"); heading right it
      // trails ("My Sets →"). Either way it points off the edge it sits on.
      pill.className = `${PILL_BASE} ${armed ? PILL_ARMED : PILL_IDLE} ${
        toLeft ? "flex-row-reverse rounded-r-2xl" : "rounded-l-2xl"
      }`;
      if (arrowRef.current) {
        arrowRef.current.style.transform = toLeft ? "rotate(180deg)" : "";
      }
      // Anchored to the destination's edge, and sliding out of it as the pull
      // fills — so "more swipe" reads as "more arrow", twice over.
      cue.style.left = toLeft ? "0px" : "auto";
      cue.style.right = toLeft ? "auto" : "0px";
      cue.style.display = "block";
      cue.style.transition = "none";
      cue.style.opacity = String(progress);
      const hidden = (1 - progress) * 100;
      cue.style.transform = `translate(${toLeft ? -hidden : hidden}%, -50%)`;
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
      showCue(target, progress, dx > 0);
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
        const href = tabsRef.current[toIndex]?.href;
        // Keep the destination highlighted through the navigation, and leave
        // the cue up (solid) while the new page fades in — it's the only
        // feedback between the release and the route change.
        setPreviewIndex(toIndex);
        preview = toIndex;
        showCue(toIndex, 1, dx > 0);
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
        className="pointer-events-none fixed top-1/2 z-40"
        style={{ display: "none", opacity: 0 }}
      >
        <div ref={pillRef} className={`${PILL_BASE} ${PILL_IDLE} rounded-l-2xl`}>
          <span ref={labelRef} />
          <svg
            ref={arrowRef}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 shrink-0"
          >
            {/* A plain chevron, pointing at the tab you're heading for
                (flipped for the left-hand one). */}
            <path d="M9 6l6 6-6 6" />
          </svg>
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
