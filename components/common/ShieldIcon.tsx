// Small shield marking an admin-only surface. Paired with the amber accent the
// rest of the app uses for admin affordances (the Navbar's admin tabs, the
// calendar's Preview Mode button).
export default function ShieldIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        d="M10 1.5l6 2.25v4.5c0 3.9-2.55 7.35-6 8.25-3.45-.9-6-4.35-6-8.25v-4.5L10 1.5zm0 2.13L6 5.13v3.12c0 2.86 1.77 5.4 4 6.2 2.23-.8 4-3.34 4-6.2V5.13l-4-1.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
