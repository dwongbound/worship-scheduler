"use client";
// Top navigation: tabs, dark-mode toggle, swap-alert red dot, user menu.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import Dropdown from "./common/Dropdown";
import Banner from "./common/Banner";
import Logo from "./Logo";
import OrgSwitcher from "./OrgSwitcher";
import GuidedTour from "./GuidedTour";
import { useBeginNavigation } from "./LoadingProvider";
import { useOrgs } from "./OrgProvider";
import { setNavDirection } from "@/lib/navDirection";
import { useSwipe } from "./SwipeProvider";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "@/lib/theme";
import type { ApiAvailabilityStatus, ApiNotifications } from "@/lib/types";

// Fired by the Swaps tab after any swap action so the red dot refreshes
// immediately instead of waiting for the next poll.
export const SWAPS_CHANGED_EVENT = "swaps-changed";
// Fired by the Availabilities tab when a user marks availability complete, so
// the reminder dot/banner clear immediately.
export const AVAILABILITY_CHANGED_EVENT = "availability-changed";
// Fired by the Profile page after a save, so the "finish your profile" reminder
// dot/banner clear the moment the user picks their first instrument.
export const PROFILE_CHANGED_EVENT = "profile-changed";
// Fired by the Team tab after any team-membership edit, so the "users with no
// team" reminder dot/banner refresh immediately instead of on the next poll.
export const TEAMS_CHANGED_EVENT = "teams-changed";

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [theme, setTheme] = useState<Theme>("system");
  const [openSwapCount, setOpenSwapCount] = useState(0);
  // Published as the `--app-header-h` CSS var so full-height pages (e.g. the
  // calendar) can size themselves to the space below the nav — which grows and
  // shrinks as reminder banners appear/dismiss.
  // Wraps the in-flow spacer + banners (not the fixed bar) — see the render.
  const navRef = useRef<HTMLDivElement>(null);
  // Per-org active requests + whether ANY still needs my response.
  const [availStatus, setAvailStatus] = useState<ApiAvailabilityStatus | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // True until the user has picked at least one instrument/role — new accounts
  // start empty, so this drives a "finish your profile" reminder dot + banner.
  const [needsRoles, setNeedsRoles] = useState(false);
  const [instrumentsBannerDismissed, setInstrumentsBannerDismissed] = useState(false);
  // Admins only: members of the selected admin org who aren't on any team yet.
  // Drives the Team tab's reminder dot + a banner linking to each person.
  const [teamlessUsers, setTeamlessUsers] = useState<
    { id: string; name: string; username: string }[]
  >([]);
  const [teamlessBannerDismissed, setTeamlessBannerDismissed] = useState(false);
  // Admins only: pending cover/swap approvals in the selected admin org →
  // the Approvals tab's reminder dot.
  const [approvalCount, setApprovalCount] = useState(0);
  // Href of the tab just clicked, so it highlights immediately instead of
  // waiting for `pathname` to update after the new page mounts.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const beginNavigation = useBeginNavigation();
  const router = useRouter();
  // The org the admin tabs operate on — the teamless reminder scopes to it, so
  // its banner links land on the /users list that actually shows those people.
  const { orgs, adminOrgId } = useOrgs();

  // Shared with SwipePager: the navbar writes the live tab list / active index /
  // navigate fn here, and reads back `previewIndex` — the tab the in-progress
  // swipe is heading toward — so the highlight updates live during the drag.
  const {
    tabsRef: tabHrefsRef,
    activeIndexRef,
    navigateRef,
    previewIndex,
  } = useSwipe();

  // Phone bottom bar shrinks to icons-only on scroll down (labels collapse) and
  // expands back to icon + label on scroll up or near the top. It never fully
  // hides, so navigation stays one tap away.
  const [bottomBarCompact, setBottomBarCompact] = useState(false);

  // Read the persisted mode after mount (localStorage is client-only).
  useEffect(() => {
    setTheme(getStoredTheme());
  }, []);

  // Once the real route catches up to the clicked tab, drop the optimistic
  // highlight so `pathname` is the single source of truth again.
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Track scroll direction to shrink/expand the phone bottom bar. Uses a ref
  // (not state) for the last position so the passive scroll listener never
  // needs to re-attach, and rAF-throttles so it only recalculates once per
  // frame.
  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - lastY;
        if (y < 40) {
          setBottomBarCompact(false);
        } else if (delta > 8) {
          setBottomBarCompact(true);
        } else if (delta < -8) {
          setBottomBarCompact(false);
        }
        lastY = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

  // Every navbar reminder dot/banner comes from ONE request: the swap-dot
  // count, availability status, whether the profile still needs instruments,
  // and (for the selected admin org) its team-less members. Aggregating avoids
  // the four parallel fetches + re-polls the navbar used to fire on every page.
  const refreshNotifications = useCallback(async () => {
    try {
      // Pass the admin org so team-less members scope to it (the server returns
      // them only to that org's admins; a non-admin or absent org yields []).
      const url = adminOrgId
        ? `/api/notifications?orgId=${adminOrgId}`
        : "/api/notifications";
      const res = await fetch(url);
      if (!res.ok) return;
      const data: ApiNotifications = await res.json();
      setOpenSwapCount(data.swapCount);
      setAvailStatus(data.availability);
      setNeedsRoles(data.needsRoles);
      setTeamlessUsers(data.teamless);
      setApprovalCount(data.approvalCount);
    } catch {
      // network hiccup — keep the old values
    }
  }, [adminOrgId]);

  useEffect(() => {
    // Wait for the org context: adminOrgId settles from "" to the persisted
    // admin org once /api/orgs resolves, so firing before then would notify
    // once unscoped and again scoped. Gating on `orgs` collapses that to one.
    if (!session || !orgs) return;
    refreshNotifications();
    // Poll so the dots stay fresh without a reload; every reminder-changing
    // action also fires an event below for an instant refresh.
    const interval = setInterval(refreshNotifications, 60_000);
    window.addEventListener(SWAPS_CHANGED_EVENT, refreshNotifications);
    window.addEventListener(AVAILABILITY_CHANGED_EVENT, refreshNotifications);
    window.addEventListener(PROFILE_CHANGED_EVENT, refreshNotifications);
    window.addEventListener(TEAMS_CHANGED_EVENT, refreshNotifications);
    return () => {
      clearInterval(interval);
      window.removeEventListener(SWAPS_CHANGED_EVENT, refreshNotifications);
      window.removeEventListener(AVAILABILITY_CHANGED_EVENT, refreshNotifications);
      window.removeEventListener(PROFILE_CHANGED_EVENT, refreshNotifications);
      window.removeEventListener(TEAMS_CHANGED_EVENT, refreshNotifications);
    };
  }, [session, orgs, refreshNotifications]);

  // A dismissal only applies to the org it was made for — switching admin orgs
  // brings the (differently-scoped) teamless banner back.
  useEffect(() => {
    setTeamlessBannerDismissed(false);
  }, [adminOrgId]);

  // Keep `--app-header-h` in sync with the nav's real height (bar + any
  // banners), so the calendar's `100dvh - header` math stays correct no matter
  // how many banners are showing. Must stay above the early return below so
  // hook order is identical on every route.
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty(
        "--app-header-h",
        `${el.offsetHeight}px`
      );
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
      label: "My Sets",
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
          {
            href: "/users",
            label: "Team",
            icon: USERS_ICON,
            admin: true,
            dot: teamlessUsers.length > 0,
            dotTestId: "team-dot",
          },
          {
            href: "/approvals",
            label: "Approvals",
            icon: CHECK_ICON,
            admin: true,
            dot: approvalCount > 0,
            dotTestId: "approval-dot",
          },
        ]
      : []),
  ];

  // Shared by both nav bars: is this tab the highlighted one, and what to do
  // on click. Prefer the just-clicked tab so selection is instant; fall back
  // to the real route once navigation completes.
  const isActive = (href: string) =>
    pendingHref ? pendingHref === href : pathname.startsWith(href);
  // During a swipe, SwipePager sets `previewIndex` so the highlight follows the
  // drag to the tab you're heading toward; otherwise use the real/pending tab.
  const tabActive = (index: number, href: string) =>
    previewIndex != null ? index === previewIndex : isActive(href);

  const handleTabClick = (href: string) => {
    // Show the shared loader and highlight the clicked tab the instant it's
    // clicked, before the next page mounts.
    if (pathname !== href) {
      setPendingHref(href);
      beginNavigation();
    }
  };

  // Admin tabs are collapsed into a single hover "Admin" dropdown on the
  // desktop strip. The trigger reads as active when any admin page is open, and
  // shows a red dot if any of its tabs (Team/Approvals) has one.
  const adminTabs = tabs.filter((t) => "admin" in t && t.admin === true);
  const adminGroupActive = adminTabs.some((t) => isActive(t.href));
  const adminHasDot = adminTabs.some((t) => "dot" in t && t.dot);

  // Feed the swipe handler the current tab order, active tab, and a navigate
  // fn (same optimistic highlight + loader a tab tap gets, then a real push).
  tabHrefsRef.current = tabs.map((t) => t.href);
  activeIndexRef.current = Math.max(
    0,
    tabs.findIndex((t) => isActive(t.href))
  );
  navigateRef.current = (href) => {
    // Tell SwipePager which way the content should slide: swiping to a
    // right-hand tab slides the new page in from the right, and vice versa.
    const to = tabHrefsRef.current.indexOf(href);
    setNavDirection(Math.sign(to - activeIndexRef.current));
    handleTabClick(href);
    router.push(href);
  };

  return (
    <>
    {/* The bar is `fixed`, not `sticky`: a sticky element still lives in the
        document flow, so the browser's rubber-band overscroll drags it along
        with the page and exposes the background above it. Fixed is anchored to
        the viewport and rides out the bounce.
        `h-16` is load-bearing — it must match the in-flow spacer below, which
        is what actually reserves the bar's space. Height is pinned rather than
        derived from the content so the two can't drift apart. */}
    <nav className="fixed inset-x-0 top-0 z-30 h-16 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* h-full (rather than py-3) centers the row inside the bar's fixed
          h-16 — the padding alone would leave it a few px off-centre. */}
      <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-2 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-4">
          {/* Page logo, far left */}
          <Link href="/calendar" aria-label="Worship Scheduler home" className="shrink-0">
            <Logo className="h-9 w-9" />
          </Link>
          {/* Desktop tab area — hidden on phones, where the floating bottom bar
              (below) takes over. The Admin dropdown sits OUTSIDE the scrolling
              strip: `overflow-x-auto` there forces overflow-y to clip too, which
              would cut off the dropdown panel dropping below the bar. */}
          <div className="hidden items-center gap-1 sm:flex">
          {/* Main tabs strip — `overflow-x-auto` guards awkward mid-size widths.
              Clipping overflow-y would cut off the notification dots that stick
              out past each tab's top-right corner, so `p-2 -m-2` pads all four
              sides inside the clip box (room for the dots) and cancels it with a
              matching negative margin, leaving the layout unchanged. */}
          <div className="flex gap-1 overflow-x-auto p-2 -m-2">
            {tabs.map((tab, i) => {
            // Admin tabs render inside the "Admin" dropdown below, not inline.
            if ("admin" in tab && tab.admin === true) return null;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                data-tour={tab.href}
                onClick={() => handleTabClick(tab.href)}
                className={tabClassName(tabActive(i, tab.href), false)}
              >
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

            {/* Admin dropdown: collapses the amber admin tabs into one "Admin"
                trigger. Opens on hover and LATCHES open on click — the shared
                Dropdown handles both, so this menu behaves like the profile and
                overflow menus instead of vanishing the moment you steer off it. */}
            {adminTabs.length > 0 && (
              <Dropdown
                hover
                align="left"
                widthClassName="min-w-[11rem]"
                trigger={(open) => (
                  <span
                    data-tour="/admin"
                    className={adminTriggerClassName(adminGroupActive)}
                  >
                    <ShieldIcon />
                    Admin
                    {adminHasDot && (
                      <span
                        data-testid="admin-dot"
                        className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500"
                      />
                    )}
                    <ChevronIcon
                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                        open ? "rotate-180" : ""
                      }`}
                    />
                  </span>
                )}
              >
                {adminTabs.map((tab) => (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    data-tour={tab.href}
                    onClick={() => handleTabClick(tab.href)}
                    className={adminMenuItemClassName(isActive(tab.href))}
                  >
                    <TabIcon d={tab.icon} className="h-4 w-4 shrink-0" />
                    {tab.label}
                    {"dot" in tab && tab.dot && (
                      <span
                        data-testid={"dotTestId" in tab ? tab.dotTestId : undefined}
                        className="ml-auto h-2 w-2 rounded-full bg-red-500"
                      />
                    )}
                  </Link>
                ))}
              </Dropdown>
            )}
          </div>
        </div>


        <div className="flex items-center gap-3">
          {/* Org switcher: page-dependent (view filter / admin org / locked).
              Sits left of the ? / theme icons. */}
          {session?.user && <OrgSwitcher />}

          {/* Guided tour: "?" help button, auto-opens once per browser.
              Admins get extra steps covering the Create/Team tabs. */}
          <GuidedTour
            isAdmin={Boolean(
              session?.user?.isSuperAdmin ||
                session?.user?.memberships?.some((m) => m.isAdmin),
            )}
          />

          {/* Theme toggle: light → dark → system */}
          <button
            onClick={cycleTheme}
            aria-label={themeLabel}
            title={themeLabel}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {themeIcon}
          </button>

          {/* User menu: avatar initial → Edit profile / Log out */}
          {session?.user && (
            <Dropdown
              hover
              trigger={
                <span data-tour="profile" className="flex items-center gap-2">
                  <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-indigo-600 text-sm font-semibold text-white">
                    {(session.user.name ?? "?").charAt(0).toUpperCase()}
                    {needsRoles && (
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
                {needsRoles && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
                )}
              </Link>
              {session.user.isSuperAdmin && (
                <Link
                  href="/platform"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-600 hover:bg-gray-100 dark:text-amber-400 dark:hover:bg-gray-700"
                >
                  <ShieldIcon />
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
    </nav>

    {/* Everything below the bar lives in NORMAL FLOW. This is deliberate: the
        page content is pushed down by the browser's own layout, so it can never
        be covered by the header — not on first paint, not while a banner is
        still being fetched, not if JS is slow. The previous version padded
        <main> from a JS-measured variable, which left a window where the
        padding was stale and the nav sat on top of the content.
        The spacer reserves exactly the fixed bar's height; the banners then
        stack under it normally. navRef wraps both so `--app-header-h` still
        reports the full visual header height for the calendar's sizing. */}
    <div ref={navRef}>
      <div className="h-16" aria-hidden />

      {/* Onboarding banner: shown until a new user picks the instruments/roles
          they play, so the scheduler can actually assign them. */}
      {needsRoles && !instrumentsBannerDismissed && (
        <Banner
          tone="indigo"
          href="/profile"
          onLinkClick={() => handleTabClick("/profile")}
          onDismiss={() => setInstrumentsBannerDismissed(true)}
        >
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
        <Banner
          tone="amber"
          href="/schedule"
          onLinkClick={() => handleTabClick("/schedule")}
          onDismiss={() => setBannerDismissed(true)}
        >
          {/* The request itself is the link, styled like the instruments
              banner's so it reads as clickable rather than as plain text —
              the trailing "→" alone was too easy to miss. Both go to the same
              place; the arrow stays for people who look for it there. */}
          {pendingAvail.request.name ? (
            <>
              {pendingAvail.request.org
                ? `${pendingAvail.request.org.name} — availability request: `
                : "Availability request: "}
              <Link
                href="/schedule"
                onClick={() => handleTabClick("/schedule")}
                className="font-semibold underline"
              >
                {pendingAvail.request.name}
              </Link>
              . Please fill it in.
            </>
          ) : (
            <>
              {pendingAvail.request.org
                ? `${pendingAvail.request.org.name}: your`
                : "Your"}{" "}
              <Link
                href="/schedule"
                onClick={() => handleTabClick("/schedule")}
                className="font-semibold underline"
              >
                availability request for{" "}
                {monthDay(pendingAvail.request.startDate)} →{" "}
                {monthDay(pendingAvail.request.endDate)}
              </Link>
              . Please fill it in.
            </>
          )}
        </Banner>
      )}

      {/* Admin reminder: people in this org who aren't on any team yet (the
          scheduler only offers a set's team members, so they'd never be
          picked). Each name links to the Team tab, scrolled to that person. */}
      {teamlessUsers.length > 0 && !teamlessBannerDismissed && (
        <Banner
          tone="amber"
          href="/users"
          onLinkClick={() => handleTabClick("/users")}
          onDismiss={() => setTeamlessBannerDismissed(true)}
        >
          {teamlessUsers.length === 1
            ? "1 person isn’t on a team yet: "
            : `${teamlessUsers.length} people aren’t on a team yet: `}
          {teamlessUsers.map((u, i) => (
            <span key={u.id}>
              {i > 0 && ", "}
              <Link
                href={`/users?user=${u.username}`}
                onClick={() => handleTabClick("/users")}
                className="font-semibold underline"
              >
                {u.name}
              </Link>
            </span>
          ))}
          . Add them to a team so they can be scheduled.
        </Banner>
      )}
    </div>

    {/* Phone-only bottom bar: an app-style floating pill fixed above the
        bottom edge (respecting the iOS home-indicator safe area). Same tabs
        and red dots as the top strip, but icon-first with short labels.
        The top strip's dots keep the data-testids; duplicating them here
        would break Playwright's strict single-match lookups. */}
    <nav className="fixed inset-x-4 bottom-[calc(1.5rem+env(safe-area-inset-bottom))] z-30 sm:hidden">
      <div
        className={`mx-auto flex items-stretch rounded-full border border-gray-200/60 bg-white/50 px-1.5 py-1.5 shadow-lg backdrop-blur-xl transition-all duration-300 ease-in-out dark:border-gray-700/60 dark:bg-gray-800/50 ${
          // Scroll down → also pull the pill in horizontally (centered), so it
          // reads as a compact icons-only bar rather than a full-width one.
          bottomBarCompact ? "max-w-xs" : "max-w-md"
        }`}
      >
        {tabs.map((tab, i) => {
          const isAdminTab = "admin" in tab && tab.admin === true;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => handleTabClick(tab.href)}
              className={bottomTabClassName(tabActive(i, tab.href), isAdminTab)}
            >
              <span className="relative">
                <TabIcon d={tab.icon} />
                {"dot" in tab && tab.dot && (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-red-500" />
                )}
              </span>
              {/* Labels collapse to nothing on scroll down, leaving icons only. */}
              <span
                className={`overflow-hidden text-[10px] font-medium leading-tight transition-all duration-300 ease-in-out ${
                  bottomBarCompact ? "max-h-0 opacity-0" : "max-h-4 opacity-100"
                }`}
              >
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

// The collapsed "Admin" dropdown trigger. Mirrors an admin tab's amber accent;
// reads as active whenever the current route is one of the admin pages.
function adminTriggerClassName(active: boolean): string {
  const base =
    "relative flex shrink-0 cursor-pointer items-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`;
  }
  return `${base} text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30`;
}

// One row inside the Admin dropdown: icon + label, with the active page's row
// filled amber the same way an active tab is.
function adminMenuItemClassName(active: boolean): string {
  const base =
    "flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none";
  if (active) {
    return `${base} bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300`;
  }
  return `${base} text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/30`;
}

// Bottom-bar tab styling: stacked icon + label, evenly sharing the pill's
// width. Same indigo/amber active cues as the top strip.
function bottomTabClassName(active: boolean, admin: boolean): string {
  // `rounded-full` matches the surrounding pill so the active-tab highlight
  // echoes the bar's own corner roundness.
  const base =
    "flex flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1.5 transition-colors focus:outline-none";

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
// Check-in-a-badge (approvals).
const CHECK_ICON =
  "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z";
const USERS_ICON =
  "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z";

// Renders one of the outline paths above as an icon. Defaults to the bottom-bar
// size; the admin dropdown passes a smaller className.
function TabIcon({ d, className = "h-6 w-6" }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={d} />
    </svg>
  );
}

// Chevron for the "Admin" dropdown trigger — rotates 180° when the menu opens.
function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M6 8l4 4 4-4" />
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
