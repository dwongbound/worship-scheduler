"use client";
// Dismissible notification banner (e.g. the availability-request reminder).
//
// Styled as a FILLED BOX: a tinted fill, a border in the same hue, a leading
// status icon, and a muted ✕ on the far right. The fill and border together are
// what make it read as a deliberate notice rather than a stray line of coloured
// text — a tint alone leaves the message floating against the page.
//
// Two placements:
//   • default — spans the page under the header, bordered top and bottom so the
//     strip reads as a band across the whole width, with its text lined up with
//     the page's own content column.
//   • `inset` — sits INSIDE a card: fully rounded and bordered on all sides,
//     its own modest padding, and no content-column centering (the card
//     already provides that).
//
// Pass `onDismiss` to show the ✕, and `href` for a trailing "→" linking to
// whatever the banner is nudging toward (e.g. the Availabilities page).
import Link from "next/link";
import { ReactNode } from "react";

type BannerTone = "indigo" | "amber" | "red";

// Fill, border and text colour per tone. Kept as one string each so a tone
// changes in exactly one place and the border can't drift from the fill.
//
// The fill is TRANSLUCENT (a /10 of the tone) rather than a solid tint, so a
// banner takes on whatever it sits over — a white page, a dark card, a set
// card already carrying its own set-type tint — instead of punching a flat
// opaque rectangle through it. One pair of values covers both themes, because
// an alpha over the surface is already theme-correct; only the text needs a
// light/dark pair to stay readable.
const TONE_CLASSES: Record<BannerTone, string> = {
  indigo:
    "bg-indigo-500/10 border-indigo-500/30 text-indigo-800 dark:text-indigo-200",
  amber:
    "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200",
  red: "bg-red-500/10 border-red-500/30 text-red-800 dark:text-red-200",
};

// Slightly stronger than the text, so the icon reads as a status marker rather
// than punctuation.
const ICON_CLASSES: Record<BannerTone, string> = {
  indigo: "text-indigo-500 dark:text-indigo-400",
  amber: "text-amber-500 dark:text-amber-400",
  red: "text-red-500 dark:text-red-400",
};

export default function Banner({
  tone = "indigo",
  children,
  href,
  inset = false,
  onLinkClick,
  onDismiss,
}: {
  tone?: BannerTone;
  children: ReactNode;
  // True when the banner sits inside a card rather than across the page.
  inset?: boolean;
  // Destination for the trailing "→" call-to-action link (omit for none).
  href?: string;
  // Fired when that link is clicked (e.g. to kick off the nav loader).
  onLinkClick?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={`w-full ${
        // A page-spanning band is bordered top and bottom only — side borders
        // would be off-screen anyway, and rounding would fight the full bleed.
        inset ? "rounded-lg border" : "border-y"
      } ${TONE_CLASSES[tone]}`}
    >
      <div
        className={`flex items-center gap-2.5 text-sm ${
          inset ? "px-3 py-2" : "mx-auto max-w-7xl px-4 py-2.5 sm:px-6 lg:px-8"
        }`}
      >
        <ToneIcon tone={tone} />
        {/* min-w-0 so long text truncates within the row instead of pushing the
            ✕ off the right edge. */}
        <span className="min-w-0 flex-1">
          {children}
          {/* Trailing call-to-action arrow, right after the text and bold. */}
          {href && (
            <Link
              href={href}
              onClick={onLinkClick}
              aria-label="Go there"
              className="ml-1.5 whitespace-nowrap text-sm font-bold hover:opacity-70"
            >
              →
            </Link>
          )}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            // Muted until hovered: dismissing is always available but never the
            // point of the banner, so it shouldn't compete with the message.
            className="shrink-0 rounded p-1 leading-none opacity-60 transition-opacity hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

// Amber and red warn, indigo informs — the shape says which before the colour
// does, which is the half of the signal that survives a colour-vision
// difference.
function ToneIcon({ tone }: { tone: BannerTone }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 shrink-0 ${ICON_CLASSES[tone]}`}
      aria-hidden
    >
      {tone === "indigo" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        </>
      ) : (
        <>
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </>
      )}
    </svg>
  );
}
