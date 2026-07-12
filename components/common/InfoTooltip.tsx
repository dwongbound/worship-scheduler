// Small "i" badge that reveals an explanatory tooltip on hover (or keyboard
// focus). Pure CSS — no state, no portal — so it works anywhere, including
// inside modals.
export default function InfoTooltip({
  text,
  side = "top",
}: {
  text: string;
  // Where the bubble opens. Use "bottom" when the icon sits near the top of a
  // modal, where an upward bubble would be clipped by the panel edge.
  side?: "top" | "bottom";
}) {
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        aria-label="More information"
        className="flex h-4 w-4 cursor-help select-none items-center justify-center
          rounded-full border border-gray-400 text-[10px] font-semibold leading-none
          text-gray-500 dark:border-gray-500 dark:text-gray-400"
      >
        i
      </span>
      {/* Right-aligned so it stays inside the modal even when the icon sits
          near the panel's right edge. */}
      <span
        role="tooltip"
        className={`pointer-events-none absolute right-0 z-10 w-64
          rounded-md bg-gray-900 px-3 py-2 text-xs font-normal normal-case text-gray-100
          opacity-0 shadow-lg transition-opacity duration-150
          group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-gray-700
          ${side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"}`}
      >
        {text}
      </span>
    </span>
  );
}
