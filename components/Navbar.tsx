"use client";
// Top navigation: tabs, dark-mode toggle, swap-alert red dot, user menu.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Dropdown from "./common/Dropdown";
import Banner from "./common/Banner";
import Logo from "./Logo";
import { useBeginNavigation } from "./LoadingProvider";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import type { ApiAvailabilityRequest } from "@/lib/types";

// Fired by the Swaps tab after any swap action so the red dot refreshes
// immediately instead of waiting for the next poll.
export const SWAPS_CHANGED_EVENT = "swaps-changed";
// Fired by the Availabilities tab when a user marks availability complete, so
// the reminder dot/banner clear immediately.
export const AVAILABILITY_CHANGED_EVENT = "availability-changed";

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [theme, setTheme] = useState<Theme>("system");
  const [openSwapCount, setOpenSwapCount] = useState(0);
  const [availRequest, setAvailRequest] = useState<ApiAvailabilityRequest | null>(null);
  const [availNeedsResponse, setAvailNeedsResponse] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Href of the tab just clicked, so it highlights immediately instead of
  // waiting for `pathname` to update after the new page mounts.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const beginNavigation = useBeginNavigation();

  // Read the persisted mode after mount (localStorage is client-only).
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  // Once the real route catches up to the clicked tab, drop the optimistic
  // highlight so `pathname` is the single source of truth again.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // While in "system" mode, follow live OS theme changes.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Cycle light → dark → system → light.
  const cycleTheme = () => {
    const next: Theme =
      theme === "light" ? "dark" : theme === "dark" ? "system" : "light";
    storeTheme(next);
    applyTheme(next);
    setTheme(next);
  };

  const themeIcon = theme === "light" ? "☀️" : theme === "dark" ? "🌙" : "🖥️";
  const themeLabel = `Theme: ${theme} (click to change)`;

  // Red dot: poll for open swap requests matching my instruments.
  const refreshSwapCount = useCallback(async () => {
    try {
      const res = await fetch("/api/swaps");
      if (!res.ok) return;
      const swaps = await res.json();
      setOpenSwapCount(swaps.length);
    } catch {
      // network hiccup — keep the old count
    }
  }, []);

  // Active availability request + whether I still owe a response (drives the
  // Availabilities dot + reminder banner).
  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch("/api/availability-request");
      if (!res.ok) return;
      const data = await res.json();
      setAvailRequest(data.request);
      setAvailNeedsResponse(data.needsResponse);
    } catch {
      // keep old state
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshSwapCount();
    refreshAvailability();
    const interval = setInterval(() => {
      refreshSwapCount();
      refreshAvailability();
    }, 60_000);
    window.addEventListener(SWAPS_CHANGED_EVENT, refreshSwapCount);
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, refreshAvailability);
    return () => {
      clearInterval(interval);
      window.removeEventListener(SWAPS_CHANGED_EVENT, refreshSwapCount);
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, refreshAvailability);
    };
  }, [session, refreshSwapCount, refreshAvailability]);

  // No chrome on the login page. Placed after all hooks so hook order stays
  // stable across renders (never return before a hook).
  if (pathname === "/login") return null;

  const tabs = [
    { href: "/calendar", label: "Calendar" },
    { href: "/swaps", label: "Set Manager", dot: openSwapCount > 0, dotTestId: "swap-dot" },
    {
      href: "/schedule",
      label: "Availabilities",
      dot: availNeedsResponse,
      dotTestId: "availability-dot",
    },
    // Admin-only tabs — styled distinctly (amber + shield) via tabClassName.
    ...(session?.user?.isAdmin
      ? [
          { href: "/create", label: "Create", admin: true },
          { href: "/users", label: "Team", admin: true },
        ]
      : []),
  ];

  return (
    <nav className="sticky top-0 z-30 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          {/* Page logo, far left */}
          <Link href="/calendar" aria-label="Worship Scheduler home" className="shrink-0">
            <Logo className="h-9 w-9" />
          </Link>
          {/* On a phone the tabs (up to 5 for admins) can't all fit, so the
              strip scrolls horizontally rather than overflowing the bar. */}
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => {
            // Prefer the just-clicked tab so selection is instant; fall back
            // to the real route once navigation completes.
            const active = pendingHref
              ? pendingHref === tab.href
              : pathname.startsWith(tab.href);
            const isAdminTab = "admin" in tab && tab.admin === true;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => {
                  // Show the shared loader and highlight the clicked tab the
                  // instant it's clicked, before the next page mounts.
                  if (pathname !== tab.href) {
                    setPendingHref(tab.href);
                    beginNavigation();
                  }
                }}
                className={tabClassName(active, isAdminTab)}
              >
                {isAdminTab && <ShieldIcon />}
                {tab.label}
                {"dot" in tab && tab.dot && (
                  // The "something new" red dot.
                  <span
                    data-testid={"dotTestId" in tab ? tab.dotTestId : undefined}
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500"
                  />
                )}
              </Link>
            );
          })}
          </div>
        </div>


        <div className="flex items-center gap-3">
          {/* Theme toggle: light → dark → system */}
          <button
            onClick={cycleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {themeIcon}
          </button>

          {/* User menu: avatar initial → Edit profile / Log out */}
          {session?.user && (
            <Dropdown
              trigger={
                <span className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                    {(session.user.name ?? "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="hidden text-sm font-medium sm:block">
                    {session.user.name}
                  </span>
                </span>
              }
            >
              <Link
                href="/profile"
                className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Edit profile
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Log out
              </button>
            </Dropdown>
          )}
        </div>
      </div>

      {/* Reminder banner: shown until the user submits their availability. */}
      {availNeedsResponse && availRequest && !bannerDismissed && (
        <Banner tone="amber" onDismiss={() => setBannerDismissed(true)}>
          {availRequest.name ? (
            <>Availability request: {availRequest.name}. Please fill it in.</>
          ) : (
            <>
              Your availability request for {monthDay(availRequest.startDate)} →{" "}
              {monthDay(availRequest.endDate)}. Please fill it in.
            </>
          )}
        </Banner>
      )}
    </nav>
  );
}

// "July 5"-style short date for the availability banner.
function monthDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

// Tab styling. Admin tabs get an amber accent so they read as distinct from
// the everyday tabs; the active tab is filled, inactive tabs are plain.
function tabClassName(active: boolean, admin: boolean): string {
  const base =
    "relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors";

  if (admin) {
    if (active) {
      return `${base} bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`;
    }
    return `${base} text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30`;
  }

  if (active) {
    return `${base} bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`;
  }
  return `${base} text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700`;
}

// Small shield marking an admin-only tab.
function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        fillRule="evenodd"
        d="M10 1.5l6 2.25v4.5c0 3.9-2.55 7.35-6 8.25-3.45-.9-6-4.35-6-8.25v-4.5L10 1.5zm0 2.13L6 5.13v3.12c0 2.86 1.77 5.4 4 6.2 2.23-.8 4-3.34 4-6.2V5.13l-4-1.5z"
        clipRule="evenodd"
      />
    </svg>
  );
}
