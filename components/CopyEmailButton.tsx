"use client";
// The home page's one interactive control: copy the contact address.
//
// The address is ALSO on the page as selectable text (app/page.tsx), because
// this button can fail in ways the page can't detect — `navigator.clipboard`
// is unavailable over plain HTTP and refused outright in some embedded
// browsers. When it does fail we select the address instead, so the next thing
// the visitor presses (⌘C, or the long-press menu) still works.
//
// The label itself reports the result rather than a toast: the button is the
// thing being looked at, and a toast from a page with no chrome has nowhere
// natural to sit.
import { useEffect, useRef, useState } from "react";

const IDLE = "Copy email";
const RESET_MS = 2000;

interface CopyEmailButtonProps {
  email: string;
  /** id of the element holding the address, selected when the copy fails. */
  targetId: string;
}

export default function CopyEmailButton({ email, targetId }: CopyEmailButtonProps) {
  const [label, setLabel] = useState(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A click right before unmount would otherwise set state on a dead component.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const report = (text: string) => {
    setLabel(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel(IDLE), RESET_MS);
  };

  // Put the address under the cursor so it can be copied by hand.
  const selectAddress = () => {
    const node = document.getElementById(targetId);
    const selection = window.getSelection();
    if (!node || !selection) {
      report("Copy it by hand");
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    selection.removeAllRanges();
    selection.addRange(range);
    report("Select and copy");
  };

  const copy = () => {
    // Called inside the click handler, which is the only place a browser will
    // grant clipboard access.
    if (!navigator.clipboard?.writeText) {
      selectAddress();
      return;
    }
    navigator.clipboard.writeText(email).then(() => report("Copied"), selectAddress);
  };

  return (
    <>
      <button
        type="button"
        onClick={copy}
        className="inline-flex h-11 items-center justify-center rounded-lg border border-indigo-600 px-5 text-sm font-semibold text-indigo-700 transition-colors hover:bg-indigo-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-500/10 dark:focus-visible:ring-offset-gray-900"
      >
        {label}
      </button>
      {/* The same words again, for a screen reader, without moving anything. */}
      <span role="status" aria-live="polite" className="sr-only">
        {label === IDLE ? "" : label}
      </span>
    </>
  );
}
