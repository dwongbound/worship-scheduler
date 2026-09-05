"use client";
// Calendar tab (default): a full month calendar with every set shown as a
// clickable slot chip (click → team roster modal) and .ics export. "See my
// sets" expands a resizable sidebar listing the sets I'm on (see MySetsPanel).
// The open set is mirrored in the URL as ?set=<id>, so its modal is the single
// source of truth: link a set (copy the URL) and it reopens straight to that
// set's roster.
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/common/Button";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import CalendarMonth from "@/components/CalendarMonth";
import SetDetailModal from "@/components/SetDetailModal";
import CreateSetModal from "@/components/CreateSetModal";
import MySetsPanel from "@/components/MySetsPanel";
import ExportModal from "@/components/ExportModal";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import {
  SETS_WINDOW_DEFAULT_DAYS,
  SETS_WINDOW_MAX_DAYS,
} from "@/lib/constants";
import { toYmd } from "@/lib/dates";
import { setStatus, type SetStatus } from "@/lib/setStatus";
import type { ApiAdminUser, ApiSet, ApiSwapRequest } from "@/lib/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Sidebar resize bounds. Dragging the divider so the panel would be narrower
// than MIN_PANEL_WIDTH closes it (drag all the way right to dismiss).
const MIN_PANEL_WIDTH = 220;
const maxPanelWidth = () =>
  typeof window === "undefined" ? 600 : Math.round(window.innerWidth * 0.6);

// useSearchParams() must sit under a Suspense boundary, so the page export
// just wraps the real component in one (see app/login/page.tsx).
export default function CalendarPage() {
  return (
    <Suspense>
      <CalendarView />
    </Suspense>
  );
}

function CalendarView() {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [sets, setSets] = useState<ApiSet[] | null>(null);
  // Cover requests the current user could take (already instrument-filtered by
  // /api/swaps). Powers the "you can cover this" hover popover on the calendar.
  const [takeableSwaps, setTakeableSwaps] = useState<ApiSwapRequest[]>([]);
  // The open set is derived from the URL's ?set=<id>, not its own state — that
  // way the URL and the modal can never drift apart.
  const selectedSetId = searchParams.get("set");
  const selectedSet = useMemo(
    () => (selectedSetId ? sets?.find((s) => s.id === selectedSetId) ?? null : null),
    [sets, selectedSetId]
  );
  // Day whose inline "+" (admin) create form is open, or null.
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Whether the export dialog (range picker + .ics/Excel) is open.
  const [exportOpen, setExportOpen] = useState(false);
  // Sidebar width; defaults to ~30% of the screen once mounted.
  const [panelWidth, setPanelWidth] = useState(420);
  // Per-org admin user lists (assignment dropdowns are scoped to the open
  // set's org; the person filter merges all of them).
  const [adminUsersByOrg, setAdminUsersByOrg] = useState<
    Record<string, ApiAdminUser[]>
  >({});
  // Calendar filters, both dropdowns. `filter` ("Show sets for"): "" = all
  // sets; "team:<teamId>" = one team's sets (anyone can pick these); otherwise
  // a userId — "My sets" for everyone, and admins can also pick any person.
  // statusFilter: "all" or one SetStatus.
  // The date window /api/sets is fetched with. It starts at the endpoint's own
  // default (today ± SETS_WINDOW_DEFAULT_DAYS) so the first fetch is identical
  // to what this page always sent, and only WIDENS as you page into months
  // outside it — paging back and forth inside the loaded range refetches
  // nothing. Kept in ms so the comparisons below are plain numbers.
  const [setsWindow, setSetsWindow] = useState(() => {
    const now = Date.now();
    const span = SETS_WINDOW_DEFAULT_DAYS * MS_PER_DAY;
    return { start: now - span, end: now + span };
  });

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SetStatus | "all">("all");

  // Org context: the navbar switcher's view filter ("all" or one org), and
  // which orgs I administer (gates the admin affordances per set).
  const { orgs, viewOrgId, isAdminOf, isAdminAny } = useOrgs();
  const isAdmin = isAdminAny;

  // Switching the org view recreates refetchSets and re-runs its effect, so two
  // fetches can be in flight at once. Tag each with an id and let only the
  // latest commit — otherwise a slow "All orgs" response can land after (and
  // clobber) a newer per-org one, leaving the wrong org's sets on screen.
  const setsReqId = useRef(0);
  const refetchSets = useCallback(async () => {
    // Wait until the org context has loaded before fetching. viewOrgId starts
    // at its "all" default and only settles to the persisted org once /api/orgs
    // resolves; fetching before then would fire once with the wrong scope and
    // again after it settles. `orgs` in the deps re-runs this the moment it does.
    if (!orgs) return;
    const reqId = ++setsReqId.current;
    const orgParam = viewOrgId === "all" ? `?` : `?orgId=${viewOrgId}&`;
    const range = `from=${toYmd(new Date(setsWindow.start))}&to=${toYmd(
      new Date(setsWindow.end)
    )}`;
    const [fresh, swaps] = await Promise.all([
      fetchJsonArray<ApiSet>(`/api/sets${orgParam}${range}`),
      // /api/swaps has no window — open covers are always "upcoming" and the
      // list is small, so it's fetched whole regardless of the month in view.
      fetchJsonArray<ApiSwapRequest>(
        viewOrgId === "all" ? "/api/swaps" : `/api/swaps?orgId=${viewOrgId}`
      ),
    ]);
    if (reqId !== setsReqId.current) return; // superseded by a newer refetch
    setSets(fresh);
    setTakeableSwaps(swaps);
  }, [orgs, viewOrgId, setsWindow]);

  // Confirm one of my assignments straight from its calendar hover popover
  // (same PATCH as MySetsPanel; fires SWAPS_CHANGED_EVENT so the navbar dot
  // refreshes).
  const confirmAssignment = useCallback(
    async (assignmentId: string) => {
      await fetch(`/api/assignments/${assignmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      await refetchSets();
      window.dispatchEvent(new Event(SWAPS_CHANGED_EVENT));
    },
    [refetchSets]
  );

  // Open a set: mirror its id into the URL so the modal can be linked/shared.
  const selectSet = useCallback(
    (set: ApiSet) => {
      router.replace(`${pathname}?set=${set.id}`, { scroll: false });
    },
    [router, pathname]
  );

  // Paging the month grid: widen the fetch window to cover the new month if it
  // isn't already loaded. Returning the SAME object when it's already covered
  // keeps refetchSets stable, so arrowing around inside the loaded range costs
  // no requests. When the union would exceed what the endpoint will serve, the
  // start slides forward — dropping old history rather than the month you're
  // looking at, which is what would otherwise re-create the empty-month wall.
  const handleViewMonthChange = useCallback((firstOfMonth: Date) => {
    const y = firstOfMonth.getFullYear();
    const m = firstOfMonth.getMonth();
    // The grid draws spillover days from the neighbouring months — pad a week
    // each side so those chips aren't missing.
    const gridStart = new Date(y, m, -7).getTime();
    const gridEnd = new Date(y, m + 1, 7).getTime();
    setSetsWindow((w) => {
      let start = Math.min(w.start, gridStart);
      const end = Math.max(w.end, gridEnd);
      if (start === w.start && end === w.end) return w; // already covered
      const maxSpan = SETS_WINDOW_MAX_DAYS * MS_PER_DAY;
      if (end - start > maxSpan) start = end - maxSpan;
      return { start, end };
    });
  }, []);

  // Close the modal by dropping ?set from the URL.
  const closeSet = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  useEffect(() => {
    refetchSets();
    // Joining a new org (navbar "Add an org…") widens the "All orgs" view.
    window.addEventListener(ORGS_CHANGED_EVENT, refetchSets);
    return () => window.removeEventListener(ORGS_CHANGED_EVENT, refetchSets);
  }, [refetchSets]);

  // One admin-users fetch per org I admin (the header names the org).
  useEffect(() => {
    const adminOrgIds = (orgs ?? []).filter((o) => o.isAdmin).map((o) => o.id);
    if (adminOrgIds.length === 0) return;
    Promise.all(
      adminOrgIds.map(
        async (orgId) =>
          [
            orgId,
            await fetchJsonArray<ApiAdminUser>("/api/admin/users", {
              headers: orgHeaders(orgId),
            }),
          ] as const
      )
    ).then((pairs) => setAdminUsersByOrg(Object.fromEntries(pairs)));
  }, [orgs]);

  useEffect(() => {
    setPanelWidth(Math.round(window.innerWidth * 0.3));
  }, []);

  // Drag the divider to resize. The sidebar is flush to the viewport's right
  // edge, so its width is just (viewport width − pointer x).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const endResize = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endResize);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    const onMove = (ev: PointerEvent) => {
      const next = window.innerWidth - ev.clientX;
      // Dragged past the minimum toward the right edge → close the sidebar.
      if (next < MIN_PANEL_WIDTH) {
        setPanelOpen(false);
        endResize();
        return;
      }
      setPanelWidth(Math.min(next, maxPanelWidth()));
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endResize);
  };

  const myId = session?.user?.id;

  usePageLoading(!sets);
  if (!sets) return null;

  // Apply the "Show sets for" filter (by team or by person) AND a status match
  // (statusFilter = "all" matches every status). filter = "" shows everything.
  const visibleSets = sets.filter((s) => {
    if (filter.startsWith("team:")) {
      // Team filter: only sets belonging to the chosen team.
      if ((s.teamId ?? s.team?.id) !== filter.slice("team:".length))
        return false;
    } else if (filter) {
      // Person filter: only sets the chosen user is assigned to.
      if (!s.assignments.some((a) => a.user.id === filter)) return false;
    }
    if (statusFilter !== "all" && setStatus(s) !== statusFilter) return false;
    return true;
  });

  // Teams to offer in the "Show sets for" dropdown — every distinct team that
  // has a set in view (derived from the loaded sets, so it naturally follows
  // the org view without a separate fetch). Sorted by name.
  const teamSeen = new Set<string>();
  const filterTeams = sets
    .flatMap((s) => (s.team ? [s.team] : []))
    .filter((t) => {
      if (teamSeen.has(t.id)) return false;
      teamSeen.add(t.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // People the admin person-filter can pick — every member across my admin
  // orgs (deduped), except the current user (covered by "My sets").
  const seen = new Set<string>();
  const otherPeople = Object.values(adminUsersByOrg)
    .flat()
    .filter((u) => {
      if (u.id === myId || seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // Header + calendar. Rendered either centered (panel closed) or as the
  // flex-1 left side that the sidebar pushes over (panel open).
  const mainColumn = (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      {/* Screen-reader page title — the visual layout leads with the filters. */}
      <h1 className="sr-only">Calendar</h1>
      {/* Filters (by person + set status) with the actions pushed to the right,
          all bottom-aligned so the buttons line up with the dropdowns. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-52">
          <Select
            label="Show sets for"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="">All sets</option>
            {myId && <option value={myId}>My sets</option>}
            {/* Team filters first, grouped so they read as a distinct block.
                Anyone can filter by team — teams no longer gate visibility. */}
            {filterTeams.length > 0 && (
              <optgroup label="Teams">
                {filterTeams.map((t) => (
                  <option key={t.id} value={`team:${t.id}`}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            )}
            {/* Per-person filter stays admin-only. */}
            {isAdmin && otherPeople.length > 0 && (
              <optgroup label="People">
                {otherPeople.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>
        <div className="w-52">
          <Select
            label="Set status"
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as SetStatus | "all")
            }
          >
            <option value="all">All statuses</option>
            <option value="understaffed">Needs people</option>
            <option value="confirmed">Confirmed</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="cover">Cover requested</option>
          </Select>
        </div>

        {/* Actions: right-aligned, bottom-aligned with the dropdown controls. */}
        <div className="ml-auto flex items-center gap-2">
          {/* Opens the export dialog (range picker + .ics/Excel). The chevron
              bounces on hover to signal it opens a menu, not a direct download. */}
          <Button
            variant="secondary"
            className="group"
            onClick={() => setExportOpen(true)}
          >
            Export
            <ExportChevron />
          </Button>
          {/* Rightmost: expands the "My sets" sidebar. */}
          <Button
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
          >
            Upcoming Sets
            <ExpanderChevron open={panelOpen} />
          </Button>
        </div>
      </div>

      {/* The month calendar fills the leftover height; it scrolls internally
          rather than growing the page. Click any slot chip for its full team. */}
      <div className="min-h-0 flex-1">
        <CalendarMonth
          sets={visibleSets}
          myId={myId}
          onSelectSet={selectSet}
          onConfirm={confirmAssignment}
          takeableSwaps={takeableSwaps}
          isAdmin={isAdmin}
          onCreateOnDay={setCreateDate}
          onViewMonthChange={handleViewMonthChange}
        />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile: the month grid is far too dense for a phone and the resize
          sidebar needs a pointer, so we drop both and show just the "My sets"
          list (tap a set for its full roster / to confirm / request cover).
          The panel brings its own heading + sort control; no .ics export on
          phones. */}
      <div className="md:hidden">
        <MySetsPanel
          sets={sets}
          myId={myId}
          onSelectSet={selectSet}
          onChanged={refetchSets}
        />
      </div>

      {/* Desktop (md+): the full month calendar, with the optional resizable
          "My sets" sidebar. Each layout is capped to the viewport height so the
          page itself never scrolls — the calendar (and the open sidebar) scroll
          inside themselves instead. */}
      <div className="hidden md:block">
        {panelOpen ? (
          // Break out of the centered <main> to full viewport width so the
          // sidebar is a true quarter of the screen and pushes the calendar
          // over. The fixed height + items-stretch make the panel column (and
          // therefore its divider) span the full available height.
          <div className="relative left-1/2 w-screen -translate-x-1/2 px-4">
            <div className="flex h-[calc(100dvh-var(--app-header-h)-3rem)] min-h-0">
              {mainColumn}
              <PanelDivider onPointerDown={startResize} />
              <MySetsPanel
                width={panelWidth}
                sets={sets}
                myId={myId}
                onSelectSet={selectSet}
                onChanged={refetchSets}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-[calc(100dvh-var(--app-header-h)-3rem)] min-h-0">{mainColumn}</div>
        )}
      </div>

      {/* Admin powers inside the modal are PER SET: only admins of the set's
          org can edit it, and the assignment dropdowns list that org's
          members. */}
      <SetDetailModal
        set={selectedSet}
        onClose={closeSet}
        currentUserId={myId}
        isAdmin={isAdminOf(selectedSet?.org?.id)}
        users={
          selectedSet?.org ? adminUsersByOrg[selectedSet.org.id] ?? [] : []
        }
        onChanged={refetchSets}
      />

      <CreateSetModal
        date={createDate}
        onClose={() => setCreateDate(null)}
        onCreated={refetchSets}
      />

      {/* Export dialog. It receives the on-screen (already filtered) sets and
          layers a look-ahead range on top before building the .ics/.xlsx. */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        sets={visibleSets}
      />
    </>
  );
}

// Down-chevron on the Export button; bounces on button hover to hint that it
// opens a chooser rather than downloading straight away.
function ExportChevron() {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className="h-4 w-4 transition-transform group-hover:animate-bounce"
    >
      <path
        d="M6 8l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Full-height draggable divider between the calendar and the sidebar. The
// mx-4 gives equal breathing room on both sides; the thin line is centered in
// the grab area and highlights on hover.
function PanelDivider({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      className="group relative mx-4 w-1 shrink-0 cursor-col-resize"
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-gray-200 transition-colors group-hover:bg-indigo-400 dark:bg-gray-700 dark:group-hover:bg-indigo-500" />
    </div>
  );
}

// Chevron on the expander button: points left (‹) to invite opening the
// sidebar, and right (›) to collapse it once open.
function ExpanderChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 transition-transform ${open ? "" : "rotate-180"}`}
    >
      <path
        d="M7.5 5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
