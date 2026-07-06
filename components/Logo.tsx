// The "tw" monogram page logo — a blackletter "tw" in a ringed black disc.
// Drawn as vector paths (no font dependency) so it renders identically in
// every browser and in both light/dark themes. Sized via the `className`
// (defaults to 2.25rem square).

export default function Logo({
  className = "h-9 w-9",
  title = "Worship Scheduler",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 120"
      role="img"
      aria-label={title}
      className={className}
    >
      <title>{title}</title>
      <circle cx="60" cy="60" r="58" fill="#111111" />
      <circle cx="60" cy="60" r="49" fill="none" stroke="#eaeaea" strokeWidth="2" />
      <g fill="#f5f5f5">
        {/* blackletter "t" */}
        <path d="M38 42 l8 -3 l0 40 q0 5 6 5 l5 0 l0 4 l-9 0 q-10 0 -10 -9 Z" />
        <path d="M29 51 l24 0 l0 5 l-24 0 Z" />
        <path d="M42 39 l5 -4 l4 4 l-4 4 Z" />
        {/* blackletter "w": three upright textura strokes, diamond serifs, foot bar */}
        <path d="M60 49 l7 0 l0 30 l-7 0 Z" />
        <path d="M72 49 l7 0 l0 30 l-7 0 Z" />
        <path d="M84 49 l7 0 l0 30 l-7 0 Z" />
        <path d="M60 46 l3.5 -4 l3.5 4 l-3.5 4 Z" />
        <path d="M72 46 l3.5 -4 l3.5 4 l-3.5 4 Z" />
        <path d="M84 46 l3.5 -4 l3.5 4 l-3.5 4 Z" />
        <path d="M59 77 l33 0 l0 5 l-33 0 Z" />
      </g>
    </svg>
  );
}
