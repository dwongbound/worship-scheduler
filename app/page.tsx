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
// Static apart from the copy button: no session, no database, nothing to wait
// for. The two display faces are loaded HERE rather than in app/layout.tsx, so
// the app itself never pays for a typeface only this page uses.
import type { Metadata } from "next";
import Link from "next/link";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import Logo from "@/components/Logo";
import Reveal from "@/components/Reveal";
import CopyEmailButton from "@/components/CopyEmailButton";
import RevealRoot from "@/components/RevealRoot";
import { REVEAL_STAGGER_CLASS } from "@/lib/reveal";
import { CONTACT_EMAIL, LEGAL_LINKS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "TapWorship",
  description:
    "Scheduling for teams that serve on a rota: build the roster, collect availability, and let people arrange their own covers.",
};

// Archivo for headings and IBM Plex Mono for the roster's role labels and
// times. Together they read like a printed call sheet, which is what a rota is
// — and neither competes with Figtree, the app's own face (app/layout.tsx).
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-archivo",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

const display = "font-[family-name:var(--font-archivo)]";
const mono = "font-[family-name:var(--font-plex-mono)]";

// One set's roster, which is the most characteristic thing in this product's
// world: the roles in a team's own order, the musical director marked, one
// seat asking for cover and one still open. INVENTED PEOPLE — this page is
// public, so no real member of anyone's team appears on it.
const EXAMPLE_ROSTER: { role: string; who: string; flag?: "md" | "cover" | "open" }[] = [
  { role: "Worship leader", who: "Lena Okafor" },
  { role: "Electric guitar", who: "Theo Marchetti", flag: "md" },
  { role: "Keys", who: "Priya Nair" },
  { role: "Bass", who: "Sam Adeyemi" },
  { role: "Drums", who: "Dani Reyes", flag: "cover" },
  { role: "Vocals", who: "Noor Haddad" },
  { role: "Audio — FOH", who: "Nobody yet", flag: "open" },
];

// The workflow, in the order it actually happens — which is why these are
// numbered and the old feature grid wasn't.
const STEPS = [
  {
    title: "Ask once",
    body: "People block the days they’re away, or import their own calendar.",
  },
  {
    title: "Fill the month",
    body: "A month of sets in one pass, balanced and spaced across the team.",
  },
  {
    title: "Covers sort themselves",
    body: "Someone can’t make it, a teammate takes the slot, an admin approves.",
  },
  {
    title: "Everyone is told",
    body: "Slack reminders and calendar invites go out on their own.",
  },
];

const CONTACT_ID = "contact-email";

const primaryButton =
  "inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-gray-900";

export default function HomePage() {
  return (
    <div className={`${archivo.variable} ${plexMono.variable}`}>
      {/* Anchor jumps glide rather than teleport, and the page's sections
          rise into view as you reach them. /login arms the same thing, which
          is why both halves live in one component. */}
      <RevealRoot />
      {/* The mark and the name together, which is what the OAuth review
          matches against the consent screen. Sticky so "Get started" is always
          one press away however far down the page you are. */}
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-gray-50/85 backdrop-blur dark:border-gray-800 dark:bg-gray-900/85">
        <div className="mx-auto flex max-w-5xl items-center gap-5 px-4 py-3">
          <a href="#top" className="mr-auto flex min-w-0 items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className={`${display} text-lg font-semibold`}>TapWorship</span>
          </a>
          <a
            href="#how"
            className="hidden text-sm font-medium text-gray-600 hover:text-gray-900 sm:inline dark:text-gray-400 dark:hover:text-gray-100"
          >
            How it works
          </a>
          {/* The way IN, for someone who already has an account. The hero's
              button below is for someone who doesn't — it goes to the contact
              block instead, since there is no self-serve sign-up. */}
          <Link href="/login" className={`${primaryButton} h-9 px-4`}>
            Sign in
          </Link>
        </div>
      </header>

      {/* A single soft wash behind the hero, so the page opens on something
          warmer than flat grey. Decorative and inert: it takes no space, is
          hidden from the accessibility tree, and sits earlier in the document
          than every section — which is what puts it behind them, since a
          negative z-index would put it behind the page's own background
          instead and show nothing at all. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-[-11rem] left-1/2 h-[24rem] w-[52rem] max-w-[140vw] -translate-x-1/2 rounded-full bg-indigo-200/45 blur-3xl dark:bg-indigo-500/10"
      />

      <section id="top" className="relative mx-auto max-w-5xl px-4 py-12 sm:py-16">
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <div>
            <Reveal
              as="p"
              className={`${mono} text-xs tracking-[0.14em] text-gray-500 uppercase dark:text-gray-400`}
            >
              Rota scheduling
            </Reveal>
            <Reveal
              as="h1"
              delayIndex={1}
              className={`${display} mt-4 text-4xl leading-[1.05] font-bold tracking-tight text-balance sm:text-5xl`}
            >
              Who&rsquo;s playing Sunday?
            </Reveal>
            <Reveal
              as="p"
              delayIndex={2}
              className="mt-5 max-w-[34ch] text-lg text-gray-600 dark:text-gray-300"
            >
              TapWorship builds the roster, keeps everyone&rsquo;s availability in
              one place, and lets the team sort out its own covers.
            </Reveal>
            {/* "Get started" means getting an organization set up, which is a
                conversation, not a form — so it lands on the contact block at
                the foot of the page rather than on /login. Anyone who already
                has an account wants the header's Sign in, which the line
                beside it points at. */}
            <Reveal delayIndex={3} className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-3">
              <a href="#contact" className={primaryButton}>
                Get started
              </a>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Already in a team?{" "}
                <Link
                  href="/login"
                  className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
                >
                  Sign in
                </Link>
                .
              </span>
            </Reveal>
          </div>

          {/* The card arrives last and as one piece, then its rows fill in —
              one observer for the lot, the stagger being pure CSS. */}
          <Reveal
            delayIndex={2}
            className={`${REVEAL_STAGGER_CLASS} overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800`}
            aria-label="Example set roster"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-gray-200 px-4 py-3.5 dark:border-gray-700">
              <h2 className={`${display} text-base font-semibold`}>Sunday Service</h2>
              <span
                className={`${mono} text-xs whitespace-nowrap text-gray-500 tabular-nums dark:text-gray-400`}
              >
                SUN 11/08 &middot; 8:15 AM
              </span>
            </div>
            {EXAMPLE_ROSTER.map((seat) => (
              <div
                key={seat.role}
                className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-gray-200 px-4 py-2.5 last:border-b-0 min-[420px]:grid-cols-[8.5rem_1fr_auto] dark:border-gray-700"
              >
                <span
                  className={`${mono} col-span-full text-[0.68rem] tracking-[0.09em] text-gray-500 uppercase min-[420px]:col-span-1 dark:text-gray-400`}
                >
                  {seat.role}
                </span>
                <span
                  className={
                    seat.flag === "open"
                      ? "text-gray-500 italic dark:text-gray-400"
                      : "font-medium"
                  }
                >
                  {seat.who}
                </span>
                <span>
                  {seat.flag === "md" && (
                    <span className={`${mono} rounded bg-indigo-100 px-1.5 py-0.5 text-[0.62rem] tracking-wider text-indigo-700 uppercase dark:bg-indigo-500/15 dark:text-indigo-300`}>
                      MD
                    </span>
                  )}
                  {seat.flag === "cover" && (
                    <span className={`${mono} rounded bg-rose-100 px-1.5 py-0.5 text-[0.62rem] tracking-wider whitespace-nowrap text-rose-700 uppercase dark:bg-rose-500/15 dark:text-rose-300`}>
                      Needs cover
                    </span>
                  )}
                  {seat.flag === "open" && (
                    <span className={`${mono} rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-[0.62rem] tracking-wider text-gray-500 uppercase dark:border-gray-600 dark:text-gray-400`}>
                      Open
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Reveal>
        </div>
      </section>

      {/* scroll-mt clears the sticky header, which would otherwise sit over
          the heading the jump just landed on. */}
      <section
        id="how"
        className="scroll-mt-16 border-t border-gray-200 dark:border-gray-800"
      >
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <Reveal
            as="h2"
            className={`${display} text-2xl font-semibold tracking-tight sm:text-3xl`}
          >
            How it works
          </Reveal>
          <Reveal as="p" delayIndex={1} className="mt-1.5 text-gray-600 dark:text-gray-300">
            Four steps, in the order they actually happen.
          </Reveal>
          {/* Each step rises as you reach it, which is the one place the
              motion is doing work rather than decorating: they are numbered
              because they happen in that order, and arriving in that order
              says so. */}
          <ol className="mt-7">
            {STEPS.map((step, i) => (
              <Reveal
                as="li"
                key={step.title}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-baseline gap-x-5 gap-y-1.5 border-t border-gray-200 py-4 last:border-b sm:grid-cols-[2.25rem_minmax(0,11rem)_minmax(0,1fr)] dark:border-gray-800"
              >
                <span className={`${mono} text-sm text-gray-400 tabular-nums dark:text-gray-500`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className={`${display} text-base font-semibold`}>{step.title}</h3>
                <p className="col-start-2 text-gray-600 sm:col-start-3 dark:text-gray-300">
                  {step.body}
                </p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section
        id="contact"
        className="scroll-mt-16 border-t border-gray-200 dark:border-gray-800"
      >
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-7 gap-y-5 px-4 py-12 sm:py-14">
          <Reveal className="min-w-0 flex-[1_1_18rem]">
            <h2 className={`${display} text-2xl font-semibold tracking-tight sm:text-3xl`}>
              Get your organization started
            </h2>
            <p className="mt-1.5 text-gray-600 dark:text-gray-300">
              Contact me and I&rsquo;ll set your teams up.
            </p>
          </Reveal>
          <Reveal delayIndex={1} className="flex flex-wrap items-center gap-3">
            {/* Shown as text, not only behind the button: a copy can be refused
                and there is no way for the page to tell the visitor that. */}
            <span
              id={CONTACT_ID}
              className={`${mono} select-all rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-800`}
            >
              {CONTACT_EMAIL}
            </span>
            <CopyEmailButton email={CONTACT_EMAIL} targetId={CONTACT_ID} />
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-gray-200 dark:border-gray-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2.5 px-4 py-7">
          <Logo className="h-6 w-6" />
          <small className="mr-auto text-sm text-gray-500 dark:text-gray-400">
            TapWorship
          </small>
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-gray-600 hover:text-gray-900 hover:underline dark:text-gray-400 dark:hover:text-gray-100"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </footer>
    </div>
  );
}
