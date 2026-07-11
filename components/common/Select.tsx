"use client";
// Labeled select dropdown, same label-wrapping pattern as Input. The native
// dropdown arrow is hidden (appearance-none) and replaced with a custom
// chevron so its spacing from the edge is consistent across browsers.
import { ReactNode, SelectHTMLAttributes } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  // Keep the label for screen readers only — for compact controls that sit
  // inline in a header row where a visible label would be noise.
  hideLabel?: boolean;
  children: ReactNode;
}

export default function Select({
  label,
  hideLabel = false,
  children,
  className = "",
  ...props
}: SelectProps) {
  return (
    <label className="block">
      <span
        className={
          hideLabel
            ? "sr-only"
            : "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        }
      >
        {label}
      </span>
      <div className="relative">
        <select
          className={`w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10 text-sm
            focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
            dark:border-gray-600 dark:bg-gray-800 ${className}`}
          {...props}
        >
          {children}
        </select>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        >
          <path
            d="M6 8l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </label>
  );
}
