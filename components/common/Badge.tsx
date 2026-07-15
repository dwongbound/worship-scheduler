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

export default function Badge({
  tone = "gray",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}
