"use client";
// Calendar tab (default): a full month calendar with every set shown as a
// clickable slot chip (click → team roster modal) and .ics export. "See my
// sets" expands a resizable sidebar listing the sets I'm on (see MySetsPanel).
// The open set is mirrored in the URL as ?set=<id>, so its modal is the single
// source of truth: link a set (copy the URL) and it reopens straight to that
// set's roster.
import { useSession } from "next-auth/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Button from "@/components/common/Button";
import Select from "@/components/common/Select";
import { usePageLoading } from "@/components/LoadingProvider";
import CalendarMonth from "@/components/CalendarMonth";
import SetDetailModal from "@/components/SetDetailModal";
import CreateSetModal from "@/components/CreateSetModal";
import MySetsPanel from "@/components/MySetsPanel";
import { SWAPS_CHANGED_EVENT } from "@/components/Navbar";
import { ORGS_CHANGED_EVENT, useOrgs } from "@/components/OrgProvider";
import { fetchJsonArray, orgHeaders } from "@/lib/api";
import { setStatus, type SetStatus } from "@/lib/setStatus";
import type { ApiAdminUser, ApiSet, ApiSwapRequest } from "@/lib/types";

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
  // Sidebar width; defaults to ~30% of the screen once mounted.
  const [panelWidth, setPanelWidth] = useState(420);
  // Per-org admin user lists (assignment dropdowns are scoped to the open
  // set's org; the person filter merges all of them).
  const [adminUsersByOrg, setAdminUsersByOrg] = useState<
    Record<string, ApiAdminUser[]>
  >({});
  // Calendar filters, both dropdowns. personFilter: "" = everyone, otherwise a
  // userId — admins can pick anyone, non-admins get just "My sets" (their own
  // id). statusFilter: "all" or one SetStatus.
  const [personFilter, setPersonFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<SetStatus | "all">("all");

  // Org context: the navbar switcher's view filter ("all" or one org), and
  // which orgs I administer (gates the admin affordances per set).
  const { orgs, viewOrgId, isAdminOf, isAdminAny } = useOrgs();
  const isAdmin = isAdminAny;

  const refetchSets = useCallback(async () => {
    const orgParam = viewOrgId === "all" ? "" : `?orgId=${viewOrgId}`;
    const [fresh, swaps] = await Promise.all([
      fetchJsonArray<ApiSet>(`/api/sets${orgParam}`),
      fetchJsonArray<ApiSwapRequest>(`/api/swaps${orgParam}`),
    ]);
    setSets(fresh);
    setTakeableSwaps(swaps);
  }, [viewOrgId]);

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

  // Apply the filters: sets the chosen person is on (personFilter = "" is
  // everyone) AND a status match (statusFilter = "all" matches every status).
  const visibleSets = sets.filter((s) => {
    if (personFilter && !s.assignments.some((a) => a.user.id === personFilter))
      return false;
    if (statusFilter !== "all" && setStatus(s) !== statusFilter) return false;
    return true;
  });

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
            label={isAdmin ? "Show sets for" : "Show"}
            value={personFilter}
            onChange={(e) => setPersonFilter(e.target.value)}
          >
            <option value="">{isAdmin ? "Everyone" : "All sets"}</option>
            {myId && <option value={myId}>My sets</option>}
            {isAdmin &&
              otherPeople.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
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
            <option value="confirmed">Confirmed</option>
            <option value="unconfirmed">Unconfirmed</option>
            <option value="cover">Cover requested</option>
          </Select>
        </div>

        {/* Actions: right-aligned, bottom-aligned with the dropdown controls. */}
        <div className="ml-auto flex items-center gap-2">
          {/* Plain link download: the browser sends session cookies along. */}
          <a href="/api/export" download>
            <Button variant="secondary">Export my sets (.ics)</Button>
          </a>
          {/* Rightmost: expands the "My sets" sidebar. */}
          <Button
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
          >
            My Upcoming Sets
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
            <div className="flex h-[calc(100dvh-7rem)] min-h-0">
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
          <div className="flex h-[calc(100dvh-7rem)] min-h-0">{mainColumn}</div>
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
        allSets={sets}
        onChanged={refetchSets}
      />

      <CreateSetModal
        date={createDate}
        onClose={() => setCreateDate(null)}
        onCreated={refetchSets}
      />
    </>
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
