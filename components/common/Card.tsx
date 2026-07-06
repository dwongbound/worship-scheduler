"use client";
// Basic surface container used across all tabs.
import { HTMLAttributes } from "react";

export default function Card({
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm
        dark:border-gray-700 dark:bg-gray-800 ${className}`}
      {...props}
    />
  );
}
