// The shell both public legal pages share (app/privacy, app/terms): the mark,
// a title, when it was last updated, the text, and a way back to signing in.
// Signed out there's no navbar, so the back link is the only way out.
import Link from "next/link";
import Logo from "@/components/Logo";
import { LEGAL_LAST_UPDATED, LEGAL_LINKS } from "@/lib/legal";

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
        {children}
      </div>
    </section>
  );
}

export default function LegalPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  // The other page of the pair, linked at the foot.
  const other = LEGAL_LINKS.find((l) => l.label !== title);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center gap-3">
        <Logo className="h-10 w-10" />
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          TapWorship
        </span>
      </div>

      <h1 className="mt-6 text-2xl font-bold text-gray-900 dark:text-gray-100">{title}</h1>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        Last updated {LEGAL_LAST_UPDATED}
      </p>
      <p className="mt-4 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{intro}</p>

      {children}

      <div className="mt-10 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
        <Link href="/login" className="text-indigo-600 hover:underline dark:text-indigo-400">
          Back to sign in
        </Link>
        {other && (
          <Link
            href={other.href}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {other.label}
          </Link>
        )}
      </div>
    </div>
  );
}
