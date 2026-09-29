"use client";
// Reusable button. Add variants/sizes here as the app grows.
import { ButtonHTMLAttributes } from "react";
import LoadingDots from "./LoadingDots";

type Variant =
  | "primary"
  | "secondary"
  | "danger"
  | "dangerOutline"
  | "ghost"
  | "admin"
  | "info";
type Size = "sm" | "md";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400",
  secondary:
    "bg-white text-gray-900 border border-gray-300 hover:bg-gray-50 " +
    "dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-700",
  danger: "bg-red-600 text-white hover:bg-red-700 disabled:bg-red-400",
  // Destructive action that is NOT the point of the screen (Disconnect, sitting
  // beside the connect buttons). Same outlined shape as "secondary"/"admin" so a
  // toolbar still reads as one row — only the colour says "this undoes things".
  dangerOutline:
    "bg-white text-red-600 border border-red-500 hover:bg-red-50 " +
    "dark:bg-gray-800 dark:text-red-400 dark:border-red-500/70 " +
    "dark:hover:bg-red-500/10",
  ghost:
    "bg-transparent text-gray-700 hover:bg-gray-100 " +
    "dark:text-gray-300 dark:hover:bg-gray-800",
  // Admin-only action: "secondary" wearing the amber accent the app marks
  // admin surfaces with (the Navbar's admin tabs, "Org settings"). Same
  // outlined shape and ground as the neutral buttons it sits beside, so a
  // toolbar reads as one row and only the colour says "admin".
  admin:
    "bg-white text-amber-600 border border-amber-500 hover:bg-amber-50 " +
    "dark:bg-gray-800 dark:text-amber-400 dark:border-amber-500/70 " +
    "dark:hover:bg-amber-500/10",
  // Explain-this action (the review workspace's Help). Wears the brand colour
  // — `indigo-*` is remapped to the favicon teal — but as a tint rather than a
  // fill, so it reads as "blue, and not the thing you came here to press" when
  // it sits beside a solid primary.
  info:
    "bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 " +
    "dark:bg-indigo-500/10 dark:text-indigo-300 dark:border-indigo-500/40 " +
    "dark:hover:bg-indigo-500/20",
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  // This button's own action is in flight: it goes un-clickable and wears the
  // jumping dots. The label STAYS in place, just hidden, and the dots sit on
  // top of it — swapping the label out for the dots shrank the button to the
  // width of three dots mid-click, which moves everything beside it.
  loading?: boolean;
}

export default function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      // A button whose action is already running can't be pressed again.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      // `relative` only while loading, so it can't fight a caller's own
      // positioning class the rest of the time.
      className={`${loading ? "relative" : ""} inline-flex items-center justify-center gap-1.5 rounded-lg font-medium
        transition-colors disabled:cursor-not-allowed disabled:opacity-70
        ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          {/* `invisible`, not unmounted: the label is what holds the button at
              its size. The wrapper repeats the button's own flex row so an
              icon + text label reserves exactly the width it normally takes. */}
          <span className="invisible inline-flex items-center gap-1.5">
            {children}
          </span>
          <span className="absolute inset-0 flex items-center justify-center">
            <LoadingDots size="sm" />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
