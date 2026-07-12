import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";

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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the theme script may add `dark` to <html>
    // before react hydrates, which is expected.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Tell the Dark Reader browser extension to keep its hands off: the
            app ships its own dark theme, and letting Dark Reader invert an
            already-dark page collapses text and backgrounds to the same color
            (the page looks blank). This lock meta opts us out of that. */}
        <meta name="darkreader-lock" />
        <Script id="theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <Providers>
          <Navbar />
          {/* Extra bottom padding on phones so content can scroll clear of the
              floating bottom nav bar (see Navbar.tsx). */}
          <main className="mx-auto max-w-5xl px-4 pb-24 pt-6 sm:pb-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
