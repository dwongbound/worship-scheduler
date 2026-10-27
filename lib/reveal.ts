// The public home page's scroll motion, as numbers and rules (unit-tested in
// tests/unit/reveal.test.ts). The moving parts are in components/Reveal.tsx.
//
// The whole design turns on one constraint: THE PAGE MUST READ WITH NO
// JAVASCRIPT. Google's OAuth verification fetches this URL, and the page's
// reason for existing is that the review could see the app's name and mark —
// so an animation that starts at opacity 0 and waits for a script would hand
// the review a blank page and fail it the way the old login wall did.
//
// So the markup is VISIBLE as it stands. A tiny script sets
// `data-reveal="on"` on <html> before the first paint, and only that attribute
// arms the hidden-then-revealed state (see REVEAL_CSS). No script, no
// attribute, no hiding.

/** The attribute the pre-paint script sets, and the CSS keys off. */
export const REVEAL_ATTR = "data-reveal";

/** Class on anything that should rise into view. */
export const REVEAL_CLASS = "reveal";

/**
 * On a container whose own children should arrive one after another — the
 * roster's rows. The children take their cue from the nearest revealed
 * ancestor, so one observer drives the whole card. It may sit on the revealed
 * element itself (the roster card is both) or on a container inside it.
 */
export const REVEAL_STAGGER_CLASS = "reveal-stagger";

/** One step of the in-card stagger, in ms, and how many rows it covers. */
export const REVEAL_CHILD_STEP_MS = 55;
export const REVEAL_CHILD_COUNT = 10;

/** Added once it has been seen, which is what plays the transition. */
export const REVEAL_IN_CLASS = "is-in";

/** How far up from the bottom edge a thing is counted as "in view". */
export const REVEAL_ROOT_MARGIN = "0px 0px -12% 0px";

/** One step of the stagger, in ms. */
export const REVEAL_STAGGER_MS = 70;

/**
 * The longest a stagger may run. A roster of a dozen rows at 70ms each would
 * otherwise still be arriving a second after you looked at it, which reads as
 * the page being slow rather than as motion.
 */
export const REVEAL_MAX_DELAY_MS = 420;

/**
 * Whether to animate at all.
 *
 * Someone who has asked their system for less motion gets the page with none:
 * the attribute is never set, so every `.reveal` renders exactly as the markup
 * has it. That is the same state a crawler sees, which is the point — the
 * no-motion path is the one that is always correct, and the animation is the
 * enhancement on top.
 */
export function revealEnabled(prefersReducedMotion: boolean): boolean {
  return !prefersReducedMotion;
}

/** The delay for the nth item of a staggered group, capped. */
export function revealDelay(
  index: number,
  step: number = REVEAL_STAGGER_MS,
  max: number = REVEAL_MAX_DELAY_MS
): number {
  if (index <= 0) return 0;
  return Math.min(index * step, max);
}

/**
 * The script that runs before the first paint, as source.
 *
 * Inline and synchronous for the same reason app/layout.tsx's theme script is:
 * anything later than this paints the un-hidden page first and then hides it,
 * which is a flash of the whole page disappearing.
 */
export const REVEAL_SCRIPT = `try{if(!matchMedia('(prefers-reduced-motion: reduce)').matches){document.documentElement.setAttribute('${REVEAL_ATTR}','on')}}catch(e){}`;

/**
 * The rules, as source. Scoped under the attribute so that everything here is
 * inert until the script above has run.
 *
 * `will-change` is deliberately absent: these elements animate once, and a
 * standing promotion of every section to its own layer costs more than the one
 * transition it would smooth.
 */
export const REVEAL_CSS = `
@media (prefers-reduced-motion: no-preference){html{scroll-behavior:smooth}}
html[${REVEAL_ATTR}="on"] .${REVEAL_CLASS}{
  opacity:0;
  transform:translateY(18px);
  transition:opacity .62s cubic-bezier(.22,.61,.36,1),transform .62s cubic-bezier(.22,.61,.36,1);
}
html[${REVEAL_ATTR}="on"] .${REVEAL_CLASS}.${REVEAL_IN_CLASS}{opacity:1;transform:none}
html[${REVEAL_ATTR}="on"] .${REVEAL_STAGGER_CLASS} > *{
  opacity:0;
  transform:translateY(8px);
  transition:opacity .5s ease-out,transform .5s ease-out;
}
html[${REVEAL_ATTR}="on"] .${REVEAL_CLASS}.${REVEAL_IN_CLASS} .${REVEAL_STAGGER_CLASS} > *,
html[${REVEAL_ATTR}="on"] .${REVEAL_CLASS}.${REVEAL_IN_CLASS}.${REVEAL_STAGGER_CLASS} > *{
  opacity:1;transform:none;
}
${Array.from(
  { length: REVEAL_CHILD_COUNT },
  (_, i) =>
    `html[${REVEAL_ATTR}="on"] .${REVEAL_STAGGER_CLASS} > *:nth-child(${i + 1}){transition-delay:${(i + 1) * REVEAL_CHILD_STEP_MS}ms}`
).join("\n")}
`;
