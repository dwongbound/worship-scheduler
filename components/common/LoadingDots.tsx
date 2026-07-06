"use client";
// Three "jumping" dots — a small, in-place loading indicator for a single
// control/section that's updating (the rest of the page stays put). The dots
// use currentColor, so they match the surrounding text (e.g. white on a
// colored button, or pass a text-* class for a specific color).
//
//   {busy ? <LoadingDots /> : <button>Confirm</button>}

type Size = "sm" | "md" | "lg";

const DOT: Record<Size, string> = {
  sm: "h-1.5 w-1.5",
  md: "h-2.5 w-2.5",
  lg: "h-3.5 w-3.5",
};

export default function LoadingDots({
  size = "md",
  className = "",
  label = "Loading",
}: {
  size?: Size;
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`inline-flex items-end gap-1 align-middle ${className}`}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`${DOT[size]} rounded-full bg-current animate-jump`}
          // Stagger the three dots so they jump out of phase.
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
      <span className="sr-only">{label}…</span>
    </span>
  );
}
