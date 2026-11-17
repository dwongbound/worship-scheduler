"use client";

// One thing that rises into view as you reach it, on the public home page.
//
// It renders its children VISIBLE and adds nothing of its own to the markup
// beyond a class; the hiding lives entirely in the CSS that `lib/reveal.ts`
// arms, and only once the pre-paint script has set the attribute. So with no
// JavaScript — a crawler, Google's OAuth review, a blocked bundle — this is an
// ordinary <div> around ordinary content, and with "reduce motion" set it is
// the same. See lib/reveal.ts for why that way round matters.
import { useEffect, useRef, useState, type ElementType, type ReactNode } from "react";
import {
  REVEAL_CLASS,
  REVEAL_IN_CLASS,
  REVEAL_ROOT_MARGIN,
  revealDelay,
} from "@/lib/reveal";

export default function Reveal({
  children,
  as: Tag = "div",
  delayIndex = 0,
  className = "",
  ...rest
}: {
  children: ReactNode;
  /** The element to render; a list item wants <li>, not a <div> inside one. */
  as?: ElementType;
  /** Position in a staggered group — 0 arrives first, each next one later. */
  delayIndex?: number;
  className?: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    // No observer (an old browser, a test runner stub) means no way to tell
    // when this arrives — so show it rather than leave it hidden forever.
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: REVEAL_ROOT_MARGIN }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  return (
    <Tag
      ref={ref}
      className={`${REVEAL_CLASS} ${seen ? REVEAL_IN_CLASS : ""} ${className}`.trim()}
      style={delayIndex > 0 ? { transitionDelay: `${revealDelay(delayIndex)}ms` } : undefined}
      {...rest}
    >
      {children}
    </Tag>
  );
}
