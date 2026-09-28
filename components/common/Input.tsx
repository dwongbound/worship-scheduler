"use client";
// Labeled text input. The <label> wraps the <input>, which associates them
// for accessibility (and lets playwright's getByLabel find them).
import { InputHTMLAttributes } from "react";

// 16px on phones, 14px from `sm` up. Under 16px, iOS Safari zooms the whole
// page in when you focus a field and never zooms back out — so the phone size
// is a bug fix, not a type choice, and it belongs here rather than being
// remembered field by field. Skipped when the caller sets its own size: a
// compact control in a dense toolbar says `text-xs` and means it.
const FIELD_TEXT = "text-base sm:text-sm";
const hasOwnSize = (className: string) => /\btext-(xs|sm|base|lg|\[)/.test(className);

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  // Keep the label for screen readers only — for compact controls that sit
  // inline in a row where a visible label would be noise (same escape hatch
  // as Select's).
  hideLabel?: boolean;
}

export default function Input({
  label,
  hideLabel = false,
  className = "",
  ...props
}: InputProps) {
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
      <input
        className={`w-full rounded-lg border border-gray-300 bg-white px-3 py-2
          ${hasOwnSize(className) ? "" : FIELD_TEXT}
          focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500
          disabled:cursor-not-allowed disabled:opacity-60
          dark:border-gray-600 dark:bg-gray-800 ${className}`}
        {...props}
      />
    </label>
  );
}
