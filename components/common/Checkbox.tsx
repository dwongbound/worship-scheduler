"use client";
// Labeled checkbox. The label is any node, so a row can carry a chip or other
// inline markup next to its text.
//
// By default only the BOX toggles: the text beside it is a plain span wired to
// the input with aria-labelledby (so screen readers and `getByLabel` still name
// it), not a <label> that swallows clicks. Rows of these sit inside dialogs
// where the text, the chips and the empty stretch beside them are things you
// may want to click, read or select without flipping a tick you didn't aim at.
//
// Pass `rowTarget` where that's the wrong trade — a short list of plain-text
// options, nothing else in the row to click, and a 16px box is a mean target on
// a phone (the /schedule time picker). It makes the whole row a real <label>.
import { InputHTMLAttributes, ReactNode, useId } from "react";

interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "label"> {
  label: ReactNode;
  // Greyed like a disabled box but STILL clickable. For an option that's out of
  // play right now and whose click is exactly what puts it in play — see the
  // /schedule time picker, where clicking a muted "Morning" is how you turn
  // "All day" off. `disabled` is for what you genuinely can't touch; this is a
  // hint about which group is currently in effect.
  muted?: boolean;
  // Make the whole row the hit target, label text and all, by wrapping it in a
  // <label>. Off by default — see the note at the top of the file for when
  // that's right and when it isn't. Anything rendered BESIDE this component
  // (the time picker's From/To fields) stays outside the label and keeps its
  // own clicks.
  rowTarget?: boolean;
}

export default function Checkbox({
  label,
  muted,
  rowTarget,
  ...props
}: CheckboxProps) {
  const labelId = useId();
  // A real <label> is what makes the row clickable — no handler of our own, so
  // the tick, the focus and the keyboard behaviour stay the browser's.
  const Row = rowTarget ? "label" : "span";
  // A disabled box keeps its checked state but goes gray — it's showing you
  // stored data you can't edit right now, not an empty control. A muted one
  // looks the same and stays live; only the cursor tells them apart.
  const dim = props.disabled || muted;
  return (
    <Row
      className={`flex items-center gap-2 text-sm ${
        dim ? "text-gray-400 dark:text-gray-500" : ""
      } ${
        // select-none: a row you click repeatedly shouldn't highlight its own
        // text on the second click.
        rowTarget && !props.disabled ? "cursor-pointer select-none" : ""
      }`}
    >
      <input
        type="checkbox"
        aria-labelledby={labelId}
        className={`h-4 w-4 shrink-0 rounded border-gray-300 focus:ring-indigo-500
          dark:border-gray-600 dark:bg-gray-800
          ${props.disabled ? "cursor-not-allowed" : "cursor-pointer"} ${
            dim
              ? "text-gray-400 opacity-60 dark:text-gray-500"
              : "text-indigo-600"
          }`}
        {...props}
      />
      {/* min-w-0 so a long label truncates inside its row instead of pushing
          whatever sits beside it off the end. */}
      <span id={labelId} className="min-w-0">
        {label}
      </span>
    </Row>
  );
}
