"use client";
// Labeled checkbox. The label is any node, so a row can carry a chip or other
// inline markup next to its text — anything inside it still toggles the box.
import { InputHTMLAttributes, ReactNode } from "react";

interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "label"> {
  label: ReactNode;
  // By default the label fills its container, so a checkbox in a wide row has a
  // wide hit area. Set this where that row has OTHER controls in it (or just
  // empty space): the label then hugs the box and its text, and clicking the
  // blank stretch beside it does nothing.
  fitLabel?: boolean;
}

export default function Checkbox({ label, fitLabel, ...props }: CheckboxProps) {
  // A disabled box keeps its checked state but goes gray — it's showing you
  // stored data you can't edit right now, not an empty control.
  const dim = props.disabled;
  return (
    <label
      className={`flex items-center gap-2 text-sm ${
        // max-w-full keeps a long label truncating inside the row it's in.
        fitLabel ? "w-fit max-w-full" : ""
      } ${
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
