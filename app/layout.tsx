import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import Providers from "./providers";
import Navbar from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Worship Scheduler",
  description: "Schedule worship teams, cover sets, and manage availability.",
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
        <Script id="theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
        <Providers>
          <Navbar />
          <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
