"use client";
// Calendar tab (default): a full month calendar with every set shown as a
// clickable slot chip (click → team roster modal) and .ics export. "See my
// sets" expands a resizable sidebar listing the sets I'm on (see MySetsPanel).
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import { usePageLoading } from "@/components/LoadingProvider";
import CalendarMonth from "@/components/CalendarMonth";
import SetDetailModal from "@/components/SetDetailModal";
import CreateSetModal from "@/components/CreateSetModal";
import StagedScheduleModal from "@/components/StagedScheduleModal";
import MySetsPanel from "@/components/MySetsPanel";
import { fetchJsonArray } from "@/lib/api";
import { setStatus, type SetStatus } from "@/lib/setStatus";
import type { ApiAdminUser, ApiSet, StagedPlan, StagedSet } from "@/lib/types";

// Sidebar resize bounds. Dragging the divider so the panel would be narrower
// than MIN_PANEL_WIDTH closes it (drag all the way right to dismiss).
const MIN_PANEL_WIDTH = 220;
const maxPanelWidth = () =>
  typeof window === "undefined" ? 600 : Math.round(window.innerWidth * 0.6);

export default function CalendarPage() {
  const { data: session } = useSession();
  const [sets, setSets] = useState<ApiSet[] | null>(null);
  const [selectedSet, setSelectedSet] = useState<ApiSet | null>(null);
  // Day whose inline "+" (admin) create form is open, or null.
  const [createDate, setCreateDate] = useState<Date | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Sidebar width; defaults to a quarter of the screen once mounted.
  const [panelWidth, setPanelWidth] = useState(360);
  // Admins get the team list to populate the modal's assignment dropdowns.
  const [adminUsers, setAdminUsers] = useState<ApiAdminUser[]>([]);
  // Calendar filters: show only my sets, and/or only sets in these statuses
  // (empty set = all statuses).
  const [mineOnly, setMineOnly] = useState(false);
  const [statusFilter, setStatusFilter] = useState<Set<SetStatus>>(new Set());
  // A proposed team (from "Auto schedule") awaiting review, and whether the
  // admin's "Apply" is in flight.
  const [stagedPlan, setStagedPlan] = useState<StagedPlan | null>(null);
  const [applying, setApplying] = useState(false);

  const isAdmin = !!session?.user?.isAdmin;

  const refetchSets = useCallback(async () => {
    const fresh = await fetchJsonArray<ApiSet>("/api/sets");
    setSets(fresh);
    // Keep the open modal pointed at the refreshed copy of its set.
    setSelectedSet((cur) =>
      cur ? fresh.find((s) => s.id === cur.id) ?? null : cur
    );
  }, []);

  useEffect(() => {
    refetchSets();
  }, [refetchSets]);

  useEffect(() => {
    if (isAdmin) {
      fetchJsonArray<ApiAdminUser>("/api/admin/users").then(setAdminUsers);
    }
  }, [isAdmin]);

  useEffect(() => {
    setPanelWidth(Math.round(window.innerWidth * 0.25));
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

  // Commit a reviewed auto-scheduled team: the apply endpoint creates the set
  // + its PENDING assignments (and, later, sends the notifications).
  const applyPlan = async (stagedSets: StagedSet[]) => {
    setApplying(true);
    try {
      await fetch("/api/admin/generate/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sets: stagedSets }),
      });
      setStagedPlan(null);
      await refetchSets();
    } finally {
      setApplying(false);
    }
  };

  // Toggle a status in/out of the active filter set.
  const toggleStatus = (s: SetStatus) =>
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });

  // Apply the filters: "my sets" (I'm assigned) AND a status match (when any
  // status chip is active; no chips = all statuses).
  const visibleSets = sets.filter((s) => {
    if (mineOnly && !s.assignments.some((a) => a.user.id === myId)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(setStatus(s))) return false;
    return true;
  });

  // Header + calendar. Rendered either centered (panel closed) or as the
  // flex-1 left side that the sidebar pushes over (panel open).
  const mainColumn = (
    <div className="min-w-0 flex-1 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="flex items-center gap-2">
          {/* Plain link download: the browser sends session cookies along. */}
          <a href="/api/export" download>
            <Button variant="secondary">Export my sets (.ics)</Button>
          </a>
          {/* Rightmost: expands the "My sets" sidebar. */}
          <Button
            onClick={() => setPanelOpen((open) => !open)}
            aria-expanded={panelOpen}
          >
            See my sets
            <ExpanderChevron open={panelOpen} />
          </Button>
        </div>
      </div>

      {/* Filters: narrow to my sets and/or by confirmation status. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
          Filter:
        </span>
        <FilterChip active={mineOnly} onClick={() => setMineOnly((v) => !v)}>
          My sets
        </FilterChip>
        <span className="mx-1 hidden h-5 w-px bg-gray-200 dark:bg-gray-700 sm:block" />
        <FilterChip
          active={statusFilter.has("confirmed")}
          onClick={() => toggleStatus("confirmed")}
          dot="bg-green-500"
        >
          Confirmed
        </FilterChip>
        <FilterChip
          active={statusFilter.has("unconfirmed")}
          onClick={() => toggleStatus("unconfirmed")}
          dot="bg-amber-500"
        >
          Unconfirmed
        </FilterChip>
        <FilterChip
          active={statusFilter.has("cover")}
          onClick={() => toggleStatus("cover")}
          dot="bg-red-500"
        >
          Cover requested
        </FilterChip>
      </div>

      {/* The month calendar. Click any slot chip for its full team. */}
      <CalendarMonth
        sets={visibleSets}
        myId={myId}
        onSelectSet={setSelectedSet}
        isAdmin={isAdmin}
        onCreateOnDay={setCreateDate}
      />
    </div>
  );

  return (
    <>
      {/* Mobile: the month grid is far too dense for a phone and the resize
          sidebar needs a pointer, so we drop both and show just the "My sets"
          list (tap a set for its full roster / to confirm / request cover). */}
      <div className="space-y-6 md:hidden">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">My sets</h1>
          <a href="/api/export" download>
            <Button variant="secondary">Export (.ics)</Button>
          </a>
        </div>
        <MySetsPanel
          sets={sets}
          myId={myId}
          onSelectSet={setSelectedSet}
          onChanged={refetchSets}
        />
      </div>

      {/* Desktop (md+): the full month calendar, with the optional resizable
          "My sets" sidebar. */}
      <div className="hidden md:block">
        {panelOpen ? (
          // Break out of the centered <main> to full viewport width so the
          // sidebar is a true quarter of the screen and pushes the calendar
          // over. min-h + the default items-stretch make the panel column (and
          // therefore its divider) span the full page height.
          <div className="relative left-1/2 w-screen -translate-x-1/2 px-4">
            <div className="flex min-h-[calc(100vh-8rem)]">
              {mainColumn}
              <PanelDivider onPointerDown={startResize} />
              <MySetsPanel
                width={panelWidth}
                sets={sets}
                myId={myId}
                onSelectSet={setSelectedSet}
                onChanged={refetchSets}
              />
            </div>
          </div>
        ) : (
          mainColumn
        )}
      </div>

      <SetDetailModal
        set={selectedSet}
        onClose={() => setSelectedSet(null)}
        currentUserId={myId}
        isAdmin={isAdmin}
        users={adminUsers}
        onChanged={refetchSets}
      />

      <CreateSetModal
        date={createDate}
        onClose={() => setCreateDate(null)}
        onCreated={refetchSets}
        onAutoSchedule={setStagedPlan}
      />

      {/* Review step for an auto-scheduled custom set — nothing is saved (or
          announced) until the admin applies it. */}
      <StagedScheduleModal
        plan={stagedPlan}
        users={adminUsers}
        busy={applying}
        onApply={applyPlan}
        onClose={() => setStagedPlan(null)}
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

// A toggle "pill" for the calendar filter bar. Active = filled teal; an
// optional status dot precedes the label.
function FilterChip({
  active,
  onClick,
  dot,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active
          ? "border-indigo-600 bg-indigo-600 text-white"
          : "border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
      }`}
    >
      {dot && <span className={`h-2 w-2 rounded-full ${dot}`} />}
      {children}
    </button>
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
