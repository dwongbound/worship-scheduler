"use client";
// A horizontally scrolling row with a scrollbar we DRAW OURSELVES.
//
// Why not just style the native one: macOS hands out overlay scrollbars that
// fade the moment you stop scrolling, and whether CSS can opt out of that is a
// per-browser, per-OS-setting lottery (`::-webkit-scrollbar` customization is
// ignored outright once `scrollbar-width`/`scrollbar-color` are set, and even
// alone it's honored inconsistently). A row of cards that silently continues
// off-screen is a row people never scroll, so the affordance has to be certain.
//
// So: the native bar is hidden, and a plain track + thumb is rendered under the
// row, sized from scrollWidth/clientWidth and positioned from scrollLeft. It's
// always on screen, and it's draggable (and click-to-jump) like a real one.
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

interface ScrollRowProps {
  children: React.ReactNode;
  // Classes for the scrolling element itself (e.g. "flex gap-3"). The overflow
  // and native-bar hiding are added here.
  className?: string;
}

// How the thumb sits in the track, both as fractions of the track's width.
interface Thumb {
  width: number; // 0–1 — how much of the content is on screen
  left: number; // 0–1 — how far along the content we are
  // Whether the row overflows at all. When it doesn't there's nothing to point
  // at, so the whole bar is left out rather than shown full-width and inert.
  scrollable: boolean;
}

// Overflow smaller than this is subpixel rounding, not content — treating it as
// scrollable would put a permanent full-width thumb under a row that fits.
const OVERFLOW_EPSILON = 1;

// A thumb thinner than this is impossible to grab, so it stops shrinking and
// the position math scales to what's left instead.
const MIN_THUMB = 0.06;

export default function ScrollRow({ children, className = "" }: ScrollRowProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  // Starts hidden: the first measurement lands before paint (useLayoutEffect),
  // so a row that fits never flashes a bar on mount.
  const [thumb, setThumb] = useState<Thumb>({
    width: 1,
    left: 0,
    scrollable: false,
  });
  // Set while dragging the thumb: where the pointer went down, and where the
  // content was scrolled to at that moment.
  const drag = useRef<{ x: number; scrollLeft: number } | null>(null);

  // Re-derive the thumb from the scroller's current geometry.
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    // Everything already fits — no bar at all.
    if (scrollWidth - clientWidth <= OVERFLOW_EPSILON) {
      setThumb({ width: 1, left: 0, scrollable: false });
      return;
    }
    const width = Math.max(MIN_THUMB, clientWidth / scrollWidth);
    // Progress through the scrollable distance, mapped onto the space the
    // thumb can actually travel (the track minus the thumb itself).
    const progress = scrollLeft / (scrollWidth - clientWidth);
    setThumb({ width, left: progress * (1 - width), scrollable: true });
  }, []);

  useLayoutEffect(measure, [measure, children]);

  // Track everything that can change the geometry: scrolling, the row resizing,
  // and cards being added or removed inside it.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const child of Array.from(el.children)) observer.observe(child);
    window.addEventListener("resize", measure);
    return () => {
      el.removeEventListener("scroll", measure);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  // Scroll so the thumb's LEFT EDGE lands at `fraction` of the track.
  const scrollToFraction = (fraction: number) => {
    const el = scroller.current;
    if (!el) return;
    const travel = 1 - Math.max(MIN_THUMB, el.clientWidth / el.scrollWidth);
    const clamped = Math.min(Math.max(fraction, 0), travel);
    el.scrollLeft =
      travel > 0 ? (clamped / travel) * (el.scrollWidth - el.clientWidth) : 0;
  };

  // Dragging the thumb. Pointer capture keeps the drag alive when the pointer
  // leaves the (thin) thumb, which it always does.
  const onThumbDown = (e: React.PointerEvent) => {
    const el = scroller.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation(); // don't also treat this as a track click
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, scrollLeft: el.scrollLeft };
  };

  const onThumbMove = (e: React.PointerEvent) => {
    const el = scroller.current;
    const start = drag.current;
    const rect = track.current?.getBoundingClientRect();
    if (!el || !start || !rect || rect.width === 0) return;
    // A pixel of thumb travel is worth (content / track) pixels of scroll.
    const scale = el.scrollWidth / rect.width;
    el.scrollLeft = start.scrollLeft + (e.clientX - start.x) * scale;
  };

  const onThumbUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  // Clicking the bare track jumps there, centering the thumb on the click.
  const onTrackDown = (e: React.PointerEvent) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    scrollToFraction((e.clientX - rect.left) / rect.width - thumb.width / 2);
  };

  return (
    <div>
      <div
        ref={scroller}
        // The native bar is hidden in both syntaxes — this is the one place
        // where the two agreeing is all we need.
        className={`overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      >
        {children}
      </div>

      {/* The bar, only while the row actually overflows. `touch-none` so a drag
          on it doesn't also pan the page. */}
      {thumb.scrollable && (
        <div
          ref={track}
          onPointerDown={onTrackDown}
          className="mt-2 h-2 w-full cursor-pointer touch-none rounded-full bg-gray-200 dark:bg-gray-700"
        >
          <div
            onPointerDown={onThumbDown}
            onPointerMove={onThumbMove}
            onPointerUp={onThumbUp}
            onPointerCancel={onThumbUp}
            role="scrollbar"
            aria-orientation="horizontal"
            aria-label="Scroll sets"
            style={{
              width: `${thumb.width * 100}%`,
              marginLeft: `${thumb.left * 100}%`,
            }}
            className="h-full rounded-full bg-gray-400 transition-colors hover:bg-gray-500
              active:bg-gray-500 dark:bg-gray-500 dark:hover:bg-gray-400 dark:active:bg-gray-400"
          />
        </div>
      )}
    </div>
  );
}
