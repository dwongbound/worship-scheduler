"use client";
// Dismissible notification banner (e.g. the availability-request reminder).
// Tones map to semantic colors; pass onDismiss to show an ✕. Pass `href` to
// show a trailing "→" that links to whatever the banner is nudging the user
// toward (e.g. the Availabilities page).
//
// By default it spans the page under the header, with its text lined up with
// the page's own content column. Pass `inset` for one sitting INSIDE a card:
// rounded, its own modest padding, and no content-column centering (the card
// already provides that).
import Link from "next/link";
import { ReactNode } from "react";

type BannerTone = "indigo" | "amber";

const TONE_CLASSES: Record<BannerTone, string> = {
  indigo:
    "bg-indigo-50 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200",
  amber:
    "bg-amber-50 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
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
      className={`w-full ${inset ? "rounded-lg" : ""} ${TONE_CLASSES[tone]}`}
    >
      <div
        className={`flex items-center justify-between gap-3 text-sm ${
          inset
            ? "px-3 py-2"
            : "mx-auto max-w-7xl px-4 py-2.5 sm:px-6 lg:px-8"
        }`}
      >
        <span>
          {children}
          {/* Trailing call-to-action arrow, right after the text and bold. */}
          {href && (
            <Link
              href={href}
              onClick={onLinkClick}
              aria-label="Go there"
              className="ml-1.5 whitespace-nowrap text-base font-bold hover:opacity-70"
            >
              →
            </Link>
          )}
        </span>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="shrink-0 rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
