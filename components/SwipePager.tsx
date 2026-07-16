"use client";
// Interactive phone tab-swipe. The current page follows the finger as you drag
// left/right; the navbar highlight previews the tab you're heading toward. On
// release it either commits (page finishes sliding out, the next one fades in)
// or snaps back. The nav bars live outside this wrapper, so they never move —
// only the content does.
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";
import { consumeNavDirection } from "@/lib/navDirection";
import { useSwipe } from "./SwipeProvider";

// useLayoutEffect warns during SSR; fall back to useEffect on the server (the
// pre-paint positioning it buys us only matters on the client anyway).
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const PREVIEW_RATIO = 0.3; // drag this fraction of the width → preview the target
const COMMIT_RATIO = 0.4; //  …this fraction (or a quick flick) → actually go there
const FLICK_MS = 250; //       a swipe faster than this commits on less distance
const FLICK_PX = 45;
const OUT_MS = 200; //         current page finishing its slide out
const IN_MS = 250; //          next page fading in

export default function SwipePager({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { tabsRef, activeIndexRef, navigateRef, setPreviewIndex } = useSwipe();
  const elRef = useRef<HTMLDivElement>(null);

  // On a committed swipe, land the new route with NO transform and a quick
  // fade. Crucially the incoming side never carries a transform: a route-level
  // loader or a modal is `position: fixed`, and a transformed (or
  // `will-change: transform`) ancestor would become its containing block and
  // drag the "full-page" overlay around (it appeared to slide in from a
  // corner). A fade reads as a transition without that hazard. Runs before
  // paint so nothing flashes at the wrong offset.
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    setPreviewIndex(null); // the real active tab is authoritative again
    const dir = consumeNavDirection();
    el.style.transform = "";
    if (dir === 0) {
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

  // The drag itself. Attaches once (all deps are stable refs/setters) and reads
  // live tab info from the shared refs, so it never goes stale.
  useIsoLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let startX = 0;
    let startY = 0;
    let startT = 0;
    let mode: "none" | "deciding" | "drag" = "none";
    let dx = 0;
    let preview: number | null = null;

    const clear = () => {
      mode = "none";
      dx = 0;
      preview = null;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || window.innerWidth >= 640) {
        clear();
        return;
      }
      const p = window.location.pathname;
      if (p === "/login" || p === "/join") return; // no tabs on auth pages
      // Don't hijack touches while a dialog is open — its own scroll/controls
      // (e.g. a horizontally-scrolling filmstrip) should win.
      if (document.querySelector('[role="dialog"]')) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      startT = Date.now();
      mode = "deciding";
    };

    const onMove = (e: TouchEvent) => {
      if (mode === "none") return;
      const mx = e.touches[0].clientX - startX;
      const my = e.touches[0].clientY - startY;
      // Decide horizontal-drag vs vertical-scroll on the first decisive move.
      if (mode === "deciding") {
        if (Math.abs(mx) < 10 && Math.abs(my) < 10) return;
        if (Math.abs(mx) <= Math.abs(my)) {
          clear();
          return;
        }
        mode = "drag";
        el.style.transition = "none";
      }
      // We own this horizontal gesture now — stop the browser from also
      // scrolling sideways or firing its native back/forward swipe (that
      // browser swipe is what made right-swipes misbehave).
      if (e.cancelable) e.preventDefault();
      const hrefs = tabsRef.current;
      const active = activeIndexRef.current;
      const dir = mx < 0 ? 1 : -1; // finger left → next (right-hand) tab
      const neighbor = active + dir;
      const hasNeighbor = neighbor >= 0 && neighbor < hrefs.length;
      dx = mx;
      const w = window.innerWidth || 1;
      // Rubber-band when there's no tab that way.
      el.style.transform = `translateX(${hasNeighbor ? dx : dx * 0.3}px)`;
      const next = hasNeighbor && Math.abs(dx) > w * PREVIEW_RATIO ? neighbor : null;
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
      const hrefs = tabsRef.current;
      const active = activeIndexRef.current;
      const w = window.innerWidth || 1;
      const dir = dx < 0 ? 1 : -1;
      const neighbor = active + dir;
      const hasNeighbor = neighbor >= 0 && neighbor < hrefs.length;
      const flick = Date.now() - startT < FLICK_MS && Math.abs(dx) > FLICK_PX;
      const commit = hasNeighbor && (Math.abs(dx) > w * COMMIT_RATIO || flick);
      if (commit) {
        // Align both pages at the top first: the incoming route always mounts
        // scrolled to the top, so without this the slide picks up a vertical
        // jump (the page appears to come "from the bottom") when you swipe from
        // a scrolled position. A no-op when already at the top.
        window.scrollTo(0, 0);
        // Finish the slide out, keep the target highlighted, then navigate —
        // the new route fades in (above) once the path changes.
        setPreviewIndex(neighbor);
        el.style.transition = `transform ${OUT_MS}ms ease-out`;
        el.style.transform = `translateX(${dir > 0 ? -w : w}px)`;
        const href = hrefs[neighbor];
        window.setTimeout(() => navigateRef.current(href), OUT_MS);
      } else {
        // Snap back.
        setPreviewIndex(null);
        el.style.transition = `transform ${OUT_MS}ms ease-out`;
        el.style.transform = "translateX(0)";
      }
      clear();
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    // Non-passive so onMove can preventDefault once it locks into a horizontal
    // drag (needed to suppress the browser's own swipe navigation).
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

  return <div ref={elRef}>{children}</div>;
}
