"use client";
// Top navigation: tabs, dark-mode toggle, swap-alert red dot, user menu.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Dropdown from "./common/Dropdown";
import Banner from "./common/Banner";
import Logo from "./Logo";
import OrgSwitcher from "./OrgSwitcher";
import { useBeginNavigation } from "./LoadingProvider";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import type { ApiAvailabilityStatus } from "@/lib/types";

// Fired by the Swaps tab after any swap action so the red dot refreshes
// immediately instead of waiting for the next poll.
export const SWAPS_CHANGED_EVENT = "swaps-changed";
// Fired by the Availabilities tab when a user marks availability complete, so
// the reminder dot/banner clear immediately.
export const AVAILABILITY_CHANGED_EVENT = "availability-changed";
// Fired by the Profile page after a save, so the "finish your profile" reminder
// dot/banner clear the moment the user picks their first instrument.
export const PROFILE_CHANGED_EVENT = "profile-changed";

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [theme, setTheme] = useState<Theme>("system");
  const [openSwapCount, setOpenSwapCount] = useState(0);
  // Per-org active requests + whether ANY still needs my response.
  const [availStatus, setAvailStatus] = useState<ApiAvailabilityStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // True until the user has picked at least one instrument/role — new accounts
  // start empty, so this drives a "finish your profile" reminder dot + banner.
  const [needsInstruments, setNeedsInstruments] = useState(false);
  const [instrumentsBannerDismissed, setInstrumentsBannerDismissed] = useState(false);
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

  // Each org's active availability request + whether I still owe a response
  // to any of them (drives the Availabilities dot + reminder banner).
  const refreshAvailability = useCallback(async () => {
    try {
      const res = await fetch("/api/availability-request");
      if (!res.ok) return;
      setAvailStatus(await res.json());
    } catch {
      // keep old state
    }
  }, []);

  // Whether I still owe my instruments/roles (empty = brand-new account that
  // hasn't finished setting up its profile).
  const refreshProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/me");
      if (!res.ok) return;
      const me = await res.json();
      setNeedsInstruments((me.instruments?.length ?? 0) === 0);
    } catch {
      // keep old state
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    refreshSwapCount();
    refreshAvailability();
    refreshProfile();
    const interval = setInterval(() => {
      refreshSwapCount();
      refreshAvailability();
    }, 60_000);
    window.addEventListener(SWAPS_CHANGED_EVENT, refreshSwapCount);
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, refreshAvailability);
    window.addEventListener(PROFILE_CHANGED_EVENT, refreshProfile);
    return () => {
      clearInterval(interval);
      window.removeEventListener(SWAPS_CHANGED_EVENT, refreshSwapCount);
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, refreshAvailability);
      window.removeEventListener(PROFILE_CHANGED_EVENT, refreshProfile);
    };
  }, [session, refreshSwapCount, refreshAvailability, refreshProfile]);

  // No chrome on the login or join-org pages. Placed after all hooks so hook
  // order stays stable across renders (never return before a hook).
  if (pathname === "/login" || pathname === "/join") return null;

  const availNeedsResponse = availStatus?.needsResponse ?? false;
  // The banner spotlights the first org still waiting on me.
  const pendingAvail = availStatus?.items.find((i) => i.needsResponse) ?? null;

  // `mobileLabel` is the short name used by the bottom bar on phones, where
  // five tabs share the width and "Availabilities" won't fit.
  const tabs = [
    { href: "/calendar", label: "Calendar", icon: CALENDAR_ICON },
    {
      href: "/swaps",
      label: "Set Manager",
      mobileLabel: "Sets",
      icon: SWAP_ICON,
      dot: openSwapCount > 0,
      dotTestId: "swap-dot",
    },
    {
      href: "/schedule",
      label: "Availabilities",
      mobileLabel: "Availability",
      icon: CLOCK_ICON,
      dot: availNeedsResponse,
      dotTestId: "availability-dot",
    },
    // Admin-only tabs — shown to admins of ANY org (each page then scopes to
    // the org picked in the switcher), and always to platform super-admins.
    // Styled amber + shield via tabClassName.
    ...(session?.user?.isSuperAdmin ||
    session?.user?.memberships?.some((m) => m.isAdmin)
      ? [
          { href: "/create", label: "Create", icon: PLUS_ICON, admin: true },
          { href: "/users", label: "Team", icon: USERS_ICON, admin: true },
        ]
      : []),
  ];

  // Shared by both nav bars: is this tab the highlighted one, and what to do
  // on click. Prefer the just-clicked tab so selection is instant; fall back
  // to the real route once navigation completes.
  const isActive = (href: string) =>
    pendingHref ? pendingHref === href : pathname.startsWith(href);
  const handleTabClick = (href: string) => {
    // Show the shared loader and highlight the clicked tab the instant it's
    // clicked, before the next page mounts.
    if (pathname !== href) {
      setPendingHref(href);
      beginNavigation();
    }
  };

  return (
    <>
    <nav className="sticky top-0 z-30 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          {/* Page logo, far left */}
          <Link href="/calendar" aria-label="Worship Scheduler home" className="shrink-0">
            <Logo className="h-9 w-9" />
          </Link>
          {/* Tab strip — hidden on phones, where the floating bottom bar
              (below) takes over. `overflow-x-auto` guards awkward mid-size
              widths, but it also clips vertically, which would cut off the
              notification dots that stick out above each tab — the `py-2 -my-2`
              gives them room inside the clip box without changing the layout. */}
          <div className="hidden gap-1 overflow-x-auto py-2 -my-2 sm:flex">
            {tabs.map((tab) => {
            const isAdminTab = "admin" in tab && tab.admin === true;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                onClick={() => handleTabClick(tab.href)}
                className={tabClassName(isActive(tab.href), isAdminTab)}
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

          {/* Org switcher: page-dependent (view filter / admin org / locked) */}
          {session?.user && <OrgSwitcher />}

          {/* User menu: avatar initial → Edit profile / Log out */}
          {session?.user && (
            <Dropdown
              trigger={
                <span className="flex items-center gap-2">
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                    {(session.user.name ?? "?").charAt(0).toUpperCase()}
                    {needsInstruments && (
                      // Nudge new users to finish their profile.
                      <span
                        data-testid="profile-dot"
                        className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500 dark:border-gray-800"
                      />
                    )}
                  </span>
                  <span className="hidden text-sm font-medium sm:block">
                    {session.user.name}
                  </span>
                </span>
              }
            >
              <Link
                href="/profile"
                className="flex items-center justify-between gap-2 px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Edit profile
                {needsInstruments && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                )}
              </Link>
              {session.user.isSuperAdmin && (
                <Link
                  href="/platform"
                  className="block px-4 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  Platform admin
                </Link>
              )}
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

      {/* Onboarding banner: shown until a new user picks the instruments/roles
          they play, so the scheduler can actually assign them. */}
      {needsInstruments && !instrumentsBannerDismissed && (
        <Banner tone="indigo" onDismiss={() => setInstrumentsBannerDismissed(true)}>
          Finish setting up your profile:{" "}
          <Link href="/profile" className="font-semibold underline">
            add the instruments and roles you play
          </Link>{" "}
          so you can be scheduled.
        </Banner>
      )}

      {/* Reminder banner: shown until the user submits their availability
          for every org's active request (spotlights the first one waiting). */}
      {pendingAvail && !bannerDismissed && (
        <Banner tone="amber" onDismiss={() => setBannerDismissed(true)}>
          {pendingAvail.request.name ? (
            <>
              {pendingAvail.request.org
                ? `${pendingAvail.request.org.name} — availability request: `
                : "Availability request: "}
              {pendingAvail.request.name}. Please fill it in.
            </>
          ) : (
            <>
              {pendingAvail.request.org
                ? `${pendingAvail.request.org.name}: your`
                : "Your"}{" "}
              availability request for {monthDay(pendingAvail.request.startDate)} →{" "}
              {monthDay(pendingAvail.request.endDate)}. Please fill it in.
            </>
          )}
        </Banner>
      )}
    </nav>

    {/* Phone-only bottom bar: an app-style floating pill fixed above the
        bottom edge (respecting the iOS home-indicator safe area). Same tabs
        and red dots as the top strip, but icon-first with short labels.
        The top strip's dots keep the data-testids; duplicating them here
        would break Playwright's strict single-match lookups. */}
    <nav className="fixed inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-30 sm:hidden">
      <div className="mx-auto flex max-w-md items-stretch rounded-2xl border border-gray-200 bg-white/95 px-1.5 py-1.5 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-800/95">
        {tabs.map((tab) => {
          const isAdminTab = "admin" in tab && tab.admin === true;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => handleTabClick(tab.href)}
              className={bottomTabClassName(isActive(tab.href), isAdminTab)}
            >
              <span className="relative">
                <TabIcon d={tab.icon} />
                {"dot" in tab && tab.dot && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                )}
              </span>
              <span className="text-[10px] font-medium leading-tight">
                {"mobileLabel" in tab ? tab.mobileLabel : tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
    </>
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
  // `focus:outline-none` drops the browser's focus ring that otherwise lingers
  // as a rounded border on a tab after it's clicked; the active tab's filled
  // background is the selection cue instead.
  const base =
    "relative flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none";

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

// Bottom-bar tab styling: stacked icon + label, evenly sharing the pill's
// width. Same indigo/amber active cues as the top strip.
function bottomTabClassName(active: boolean, admin: boolean): string {
  const base =
    "flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 transition-colors focus:outline-none";

  if (admin) {
    if (active) {
      return `${base} bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`;
    }
    return `${base} text-amber-600 dark:text-amber-400`;
  }

  if (active) {
    return `${base} bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300`;
  }
  return `${base} text-gray-500 dark:text-gray-400`;
}

// Outline icon paths (24×24 heroicons) for the bottom bar tabs.
const CALENDAR_ICON =
  "M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5";
const SWAP_ICON =
  "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5";
const CLOCK_ICON = "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z";
const PLUS_ICON = "M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z";
const USERS_ICON =
  "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z";

// Renders one of the outline paths above as a bottom-bar icon.
function TabIcon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-6 w-6"
    >
      <path d={d} />
    </svg>
  );
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
