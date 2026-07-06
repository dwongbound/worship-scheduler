"use client";
// Dismissible full-width notification banner (e.g. the availability-request
// reminder). Tones map to semantic colors; pass onDismiss to show an ✕.
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
  onDismiss,
}: {
  tone?: BannerTone;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  return (
    <div className={`w-full ${TONE_CLASSES[tone]}`}>
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5 text-sm">
        <span>{children}</span>
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
