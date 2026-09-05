"use client";
// Labeled number field with big − / + buttons either side of the value, for
// small counts you nudge rather than type (e.g. "Weeks ahead"). There's no
// native spinner — its arrows are tiny and stacked, which is exactly what this
// replaces — but the field stays fully typeable so a jump from 2 to 20 doesn't
// take eighteen clicks: you can clear it to empty and type a new number, and
// anything that isn't a digit is simply refused.
import { useEffect, useId, useState } from "react";

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
  // What's actually in the box. It's a STRING so the field can be empty
  // mid-edit — deleting both digits of "12" to type "8" has to pass through
  // "" and "1", neither of which is the value we'd want to commit.
  const [draft, setDraft] = useState(String(value));
  // Follow the value when it changes from outside (a nudge, a reset).
  useEffect(() => setDraft(String(value)), [value]);

  const nudge = (by: number) => onChange(clamp(value + by));

  // Digits only: letters, "e", signs and dots never make it into the box.
  const type = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    setDraft(digits);
    if (digits !== "") onChange(Number(digits));
  };

  // Leaving the field settles it: an empty (or out-of-range) box snaps back to
  // the nearest legal number, so a typed 99 lands on the real maximum.
  const settle = () => {
    const next = draft === "" ? value : Number(draft);
    onChange(clamp(next));
    setDraft(String(clamp(next)));
  };

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
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // Still a spinbutton to assistive tech (and to tests): it's a number
          // field with a range, just not a native one.
          role="spinbutton"
          className="w-14 rounded-lg border border-gray-300 bg-white px-2 py-2 text-center text-sm
            [appearance:textfield] focus:border-indigo-500 focus:outline-none focus:ring-1
            focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60
            dark:border-gray-600 dark:bg-gray-800
            [&::-webkit-inner-spin-button]:appearance-none
            [&::-webkit-outer-spin-button]:appearance-none"
          value={draft}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={value}
          disabled={disabled}
          onChange={(e) => type(e.target.value)}
          onBlur={settle}
          // Enter settles the value too, rather than submitting anything.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              settle();
            }
          }}
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
