// The public home page — what a signed-out stranger (and Google's OAuth
// review) sees at the site root.
//
// It exists because the root used to be an HTTP redirect to /calendar, which
// put the whole site behind the login door: Google's verification fetches the
// home page URL with no account and saw only the sign-in screen. It also has
// to carry the app's NAME and MARK, because the review checks both against the
// consent screen's.
//
// Signed IN, nobody should ever read this page — proxy.ts sends them to
// /calendar before it renders, so "/" still means "the app" once you have an
// account (including Google's post-sign-in callback, which lands on "/").
//
// Static on purpose: no session, no database, nothing to wait for.
import type { Metadata } from "next";
import Link from "next/link";
import Logo from "@/components/Logo";
import { LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "TapWorship",
  description:
    "Scheduling for teams that serve on a rota: build the schedule, collect availability, and let people arrange their own swaps and covers.",
};

// What the app does, in the words someone outside it would use. Deliberately
// four: enough to show what the thing is, few enough to read at a glance.
const FEATURES = [
  {
    title: "Build the schedule",
    body: "Set out who plays what on each team, then fill a month of sets in one pass — balanced across everyone, around the times they've said they can't serve.",
  },
  {
    title: "Collect availability",
    body: "Ask the team for a date range and people block out the days they're away. They can import their own Google Calendar instead of filling it in by hand.",
  },
  {
    title: "Swaps and covers",
    body: "Someone who can't make a set asks for cover or proposes a straight swap. Teammates pick it up themselves, and an administrator approves the trade.",
  },
  {
    title: "Everyone knows where to be",
    body: "The schedule syncs to your organization's Google Calendar with the team invited, and the reminders go out on Slack.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {/* The mark and the name together, which is what the OAuth review
          matches against the consent screen. */}
      <div className="flex items-center gap-3">
        <Logo className="h-10 w-10" />
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          TapWorship
        </span>
      </div>

      <h1 className="mt-8 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl dark:text-gray-100">
        Scheduling for teams that serve on a rota
      </h1>
      <p className="mt-4 text-base leading-relaxed text-gray-700 dark:text-gray-300">
        TapWorship is how a church or ministry plans who is serving when. An
        administrator sets up the teams and the weekly services; everyone else
        says when they&rsquo;re free, sees the sets they&rsquo;re on, and sorts
        out their own swaps when something comes up.
      </p>

      <div className="mt-8">
        <Link
          href="/login"
          className="inline-flex h-11 items-center rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none dark:focus:ring-offset-gray-900"
        >
          Sign in
        </Link>
        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          Your organization&rsquo;s administrator gives you the key that joins
          you to it.
        </p>
      </div>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {FEATURES.map((feature) => (
          <section key={feature.title}>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {feature.title}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-gray-700 dark:text-gray-300">
              {feature.body}
            </p>
          </section>
        ))}
      </div>

      <div className="mt-12 flex flex-wrap gap-x-4 gap-y-2 border-t border-gray-200 pt-4 text-sm dark:border-gray-700">
        {LEGAL_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
