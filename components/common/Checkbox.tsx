"use client";
// Labeled checkbox.
import { InputHTMLAttributes } from "react";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function Checkbox({ label, ...props }: CheckboxProps) {
  // A disabled box keeps its checked state but goes gray — it's showing you
  // stored data you can't edit right now, not an empty control.
  const dim = props.disabled;
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        dim ? "cursor-not-allowed text-gray-400 dark:text-gray-500" : "cursor-pointer"
      }`}
    >
      <input
        type="checkbox"
        className={`h-4 w-4 rounded border-gray-300 focus:ring-indigo-500
          dark:border-gray-600 dark:bg-gray-800 ${
            dim ? "text-gray-400 opacity-60 dark:text-gray-500" : "text-indigo-600"
          }`}
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
