"use client";
// ".ics" export control. Downloads an .ics file via a plain <a download> so the
// browser sends the session cookie along. Used for both whole-calendar and
// single-set exports.
//   • Default: icon-only — the calendar icon, with `label` as the native
//     tooltip (title) and accessible name.
//   • Pass `text` to render a labeled text button instead (no icon).

export default function ExportIcsButton({
  href,
  label,
  text,
  size = "md",
}: {
  href: string;
  label: string; // tooltip + accessible name, e.g. "Export my sets (.ics)"
  text?: string; // when set, show this visible text instead of the icon
  size?: "sm" | "md";
}) {
  const box = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  const shared = `inline-flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors
    hover:bg-gray-50 hover:text-indigo-600
    dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-indigo-400`;

  if (text) {
    return (
      <a
        href={href}
        download
        title={label}
        aria-label={label}
        className={`${shared} ${
          size === "sm" ? "h-8 px-3 text-sm" : "h-9 px-3.5 text-sm"
        }`}
      >
        {text}
      </a>
    );
  }

  return (
    <a
      href={href}
      download
      title={label}
      aria-label={label}
      className={`${shared} ${box}`}
    >
      <svg
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
        className="h-[1.15rem] w-[1.15rem]"
      >
        <rect
          x="3"
          y="4.5"
          width="14"
          height="12.5"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M3 8.5h14" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M7 2.5v3M13 2.5v3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </a>
  );
}
