"use client";
// Labeled select dropdown, same label-wrapping pattern as Input. The native
// dropdown arrow is hidden (appearance-none) and replaced with a custom
// chevron so its spacing from the edge is consistent across browsers.
//
// `className` lands on the <select>, which is `w-full` inside a positioned
// wrapper that owns the chevron. So constrain the WIDTH on a wrapper of your
// own (`<div className="max-w-xs"><Select …/></div>`) — narrowing the select
// through className shrinks the box but leaves the chevron at the old right
// edge, floating in space.
import { ReactNode, SelectHTMLAttributes } from "react";

// 16px on phones, 14px from `sm` up. Under 16px, iOS Safari zooms the whole
// page in when you focus a field and never zooms back out — so the phone size
// is a bug fix, not a type choice, and it belongs here rather than being
// remembered field by field. Skipped when the caller sets its own size: a
// compact control in a dense toolbar says `text-xs` and means it.
const FIELD_TEXT = "text-base sm:text-sm";
const hasOwnSize = (className: string) => /\btext-(xs|sm|base|lg|\[)/.test(className);

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
          className={`w-full appearance-none rounded-lg border border-gray-300 bg-white px-3 py-2 pr-10
            ${hasOwnSize(className) ? "" : FIELD_TEXT}
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
