import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Figtree } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";
import SwipePager from "@/components/SwipePager";
import { SwipeProvider } from "@/components/SwipeProvider";
import ScrollToTopButton from "@/components/ScrollToTopButton";

// Figtree is the app's UI typeface — a humanist geometric sans with a tall
// x-height, picked so dense schedule views stay legible at 14px. Loaded as a
// variable font and exposed as a CSS var that tailwind.config.ts wires into
// `font-sans`, so every existing utility class picks it up automatically.
// next/font self-hosts the files at build time (no request to Google at
// runtime) and `display: swap` avoids a blank flash while it loads.
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Worship Scheduler",
  description: "Schedule worship teams, cover sets, and manage availability.",
  // "Add to Home Screen" on iOS: open standalone (no Safari chrome) with a
  // short icon label. The manifest (app/manifest.ts) covers Android; older
  // iOS needs these apple-mobile-web-app-* meta tags too.
  appleWebApp: {
    capable: true,
    title: "TapWorship",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // Colors the status bar / browser UI around the page. Media-query based,
  // so it follows the OS setting (close enough to lib/theme.ts's "system"
  // default; a manual in-app override won't be reflected here).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F9FAFB" }, // gray-50
    { media: "(prefers-color-scheme: dark)", color: "#111827" }, // gray-900
  ],
};

// Runs before hydration so the right theme applies without a flash.
// Mode is "light" | "dark" | "system"; anything else (incl. unset) = system,
// which follows the OS preference. Keep this in sync with lib/theme.ts.
const THEME_SCRIPT = `
try {
  var stored = localStorage.getItem('theme');
  var system = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var dark = stored === 'dark' ||
    (stored !== 'light' && stored !== 'dark' && system);
  document.documentElement.classList.toggle('dark', dark);
} catch (e) {}
`;

// Vercel Web Analytics is only wanted on the two deployed branches: `main`
// (which is the Vercel production env) and `staging` (a preview deployment —
// see vercel.json, which disables previews for every other branch). Off
// everywhere else, so local dev and Playwright runs don't report page views.
// Both vars are Vercel system env vars, unset outside Vercel.
const analyticsEnabled =
  process.env.VERCEL_ENV === "production" ||
  process.env.VERCEL_GIT_COMMIT_REF === "staging";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme script may add `dark` to <html>
    // before react hydrates, which is expected.
    <html lang="en" className={figtree.variable} suppressHydrationWarning>
      <head>
        {/* Tell the Dark Reader browser extension to keep its hands off: the
            app ships its own dark theme, and letting Dark Reader invert an
            already-dark page collapses text and backgrounds to the same color
            (the page looks blank). This lock meta opts us out of that. */}
        <meta name="darkreader-lock" />
        <Script id="theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      {/* `font-sans` is explicit rather than left to preflight: this project
          feeds tailwind its JS config through `@config`, and relying on that to
          reach v4's default-font plumbing is fragile. One class removes the
          guesswork. */}
      <body className="min-h-screen bg-gray-50 font-sans text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <Providers>
          {/* SwipeProvider wraps the navbar (which registers the tab list) and
              the pager (which runs the swipe gesture) so they share drag state. */}
          <SwipeProvider>
            <Navbar />
            {/* Plain `pt-6`: Navbar renders an in-flow spacer + banners above
                this, so the header's space is already reserved by layout. No
                padding math here, and nothing that can go stale.
                Extra bottom padding on phones so content can scroll clear of
                the floating bottom nav bar (see Navbar.tsx). */}
            <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 sm:pb-6 lg:px-8">
              <SwipePager>{children}</SwipePager>
            </main>
          </SwipeProvider>
          <ScrollToTopButton />
        </Providers>
        {analyticsEnabled && <Analytics />}
      </body>
    </html>
  );
}
