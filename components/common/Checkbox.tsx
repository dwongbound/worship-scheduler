"use client";
// Labeled checkbox.
import { InputHTMLAttributes } from "react";

interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export default function Checkbox({ label, ...props }: CheckboxProps) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-gray-300 text-indigo-600
          focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-800"
        {...props}
      />
      <span>{label}</span>
    </label>
  );
}
