"use client";
// Small status pill. Tones map to semantic colors; the assignment status →
// tone mapping lives in components/StatusBadge.tsx.
import { ReactNode } from "react";

export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue" | "indigo";

const TONE_CLASSES: Record<BadgeTone, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300",
  amber: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  red: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300",
  gray: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300",
  indigo:
    "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-300",
};

// "sm" is for pills that ride INSIDE another control next to the text they
// describe (the assignment dropdown's unavailable/inactive flags): small enough
// that several fit without crowding out the name itself.
export type BadgeSize = "sm" | "md";

const SIZE_CLASSES: Record<BadgeSize, string> = {
  // shrink-0 on the small one only: it sits inside a flex row next to a
  // truncating name, and the name is what should give way, not the pill.
  sm: "shrink-0 px-1.5 py-px text-[10px] leading-4",
  md: "px-2.5 py-0.5 text-xs",
};

export default function Badge({
  tone = "gray",
  size = "md",
  title,
  children,
}: {
  tone?: BadgeTone;
  size?: BadgeSize;
  // Native tooltip — for pills whose short label needs a sentence of context.
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-full font-medium ${SIZE_CLASSES[size]} ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
