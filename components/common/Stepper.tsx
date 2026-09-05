"use client";
// Labeled number field with big − / + buttons either side of the value, for
// small counts you nudge rather than type (e.g. "Weeks ahead"). The native
// up/down spinner is hidden — its arrows are tiny and stacked, which is exactly
// what this replaces — but the field itself stays typeable so a jump from 2 to
// 20 doesn't take eighteen clicks.
import { useId } from "react";

export default function Stepper({
  label,
  hideLabel = false,
  value,
  onChange,
  min = 1,
  max = 99,
  step = 1,
  disabled = false,
}: {
  label: string;
  hideLabel?: boolean;
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const id = useId();
  // Nudging never leaves the range; typing is clamped on the way out too.
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const nudge = (by: number) => onChange(clamp(value + by));

  const buttonClass =
    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border " +
    "border-gray-300 text-lg font-semibold leading-none text-gray-600 " +
    "hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 " +
    "dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700";

  return (
    <div>
      <label
        htmlFor={id}
        className={
          hideLabel
            ? "sr-only"
            : "mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
        }
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={buttonClass}
          onClick={() => nudge(-step)}
          disabled={disabled || value <= min}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          className="w-14 rounded-lg border border-gray-300 bg-white px-2 py-2 text-center text-sm
            [appearance:textfield] focus:border-indigo-500 focus:outline-none focus:ring-1
            focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60
            dark:border-gray-600 dark:bg-gray-800
            [&::-webkit-inner-spin-button]:appearance-none
            [&::-webkit-outer-spin-button]:appearance-none"
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          // A half-typed value ("" while backspacing) isn't a number yet — hold
          // the last good one rather than snapping to the minimum mid-keystroke.
          onChange={(e) => {
            const n = Number(e.target.value);
            if (e.target.value !== "" && !Number.isNaN(n)) onChange(n);
          }}
          // Clamp on the way out, so a typed 99 settles at the real maximum.
          onBlur={() => onChange(clamp(value))}
        />
        <button
          type="button"
          className={buttonClass}
          onClick={() => nudge(step)}
          disabled={disabled || value >= max}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
    </div>
  );
}
