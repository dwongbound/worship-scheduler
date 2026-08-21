"use client";
// A transient message that floats above everything (modals included) and clears
// itself. This is for the RESULT of an action the user just took: unlike an
// inline <p>, it doesn't reflow the layout it appears over, and it doesn't sit
// there forever after it's been read.
//
// Rendered through a portal into <body> so a toast raised from inside a modal
// isn't clipped by (or stacked under) the modal panel — same trick as Dropdown
// and InfoTooltip.
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "success" | "error" | "info";

export interface ToastMessage {
  text: string;
  // Defaults to "info". Only affects the color and how long it stays up.
  tone?: ToastTone;
}

// How long each tone stays on screen. Errors linger — they're the ones worth
// reading twice, and the user may want to copy the reason out.
const DURATION_MS: Record<ToastTone, number> = {
  success: 3000,
  info: 5000,
  error: 7000,
};

const TONE_CLASSES: Record<ToastTone, string> = {
  success:
    "bg-green-600 text-white dark:bg-green-500",
  error:
    "bg-red-600 text-white dark:bg-red-500",
  info:
    "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900",
};

interface ToastProps {
  // The message to show, or null for "nothing right now".
  toast: ToastMessage | null;
  // Called when the toast should go away — on timeout or on click. The parent
  // owns the state, so this is just `() => setToast(null)`.
  onDismiss: () => void;
}

export default function Toast({ toast, onDismiss }: ToastProps) {
  // The parent almost always passes an inline arrow for onDismiss, which would
  // be a new function every render — putting it in the effect's deps would
  // restart the timer on every render and the toast would never leave. Keep the
  // latest callback in a ref and depend on the message alone.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(
      () => dismissRef.current(),
      DURATION_MS[toast.tone ?? "info"]
    );
    return () => clearTimeout(timer);
    // Re-armed per message: a second toast replacing a first gets a full window.
  }, [toast]);

  if (!toast || typeof document === "undefined") return null;

  return createPortal(
    <div
      // Above modals (z-50) and their dropdowns (z-[60]/z-[61]). Pinned to the
      // bottom on phones and bottom-right on wider screens; pointer-events are
      // off on the wrapper so the toast never blocks clicks around it.
      className="pointer-events-none fixed inset-x-0 bottom-4 z-[70] flex justify-center px-4 sm:justify-end sm:px-6"
    >
      <div
        // role=status (not alert) so screen readers announce it politely
        // without interrupting whatever the user is doing.
        role="status"
        aria-live="polite"
        onClick={onDismiss}
        className={`pointer-events-auto max-w-md cursor-pointer rounded-lg px-4 py-2.5
          text-sm shadow-lg animate-toast-in ${TONE_CLASSES[toast.tone ?? "info"]}`}
      >
        {toast.text}
      </div>
    </div>,
    document.body
  );
}
