"use client";
// Availabilities tab: tell the scheduler when you're NOT free.
//   • Admin Requests — respond to an admin's request by blocking dates inside
//     its window, then submit.
//   • Block out times — the general form: a one-off specific date/range OR a
//     weekly recurring block (both with a time-of-day window).
// The "Busy Blocks" column is the single source of truth for viewing/deleting:
// the union of every block as a calendar (desktop) plus one scrollable,
// deletable list.
//   Desktop: editors (Admin Requests, Block out times) LEFT, Busy Blocks RIGHT.
//   Mobile:  Admin Requests → Busy Blocks list → Block out times.
import { FormEvent, useCallback, useEffect, useState } from "react";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { AVAILABILITY_CHANGED_EVENT } from "@/components/Navbar";
import { blockedDaysInRange, dayBlockLevel } from "@/lib/availability";
import { DAY_LABELS } from "@/lib/constants";
import {
  dateRangeLabel,
  minutesToTimeLabel,
  shortDateLabel,
  shortRangeLabel,
  timeStringToMinutes,
} from "@/lib/dates";
import type { ApiAvailabilityRequest, ApiUnavailability } from "@/lib/types";

// My completion status for one request. The row persists once touched:
// completedAt = null means currently marked "not submitted"; `edited` is true
// once it's been re-submitted after an unsubmit.
interface AvailabilityResponse {
  requestId: string;
  completedAt: string | null;
  edited: boolean;
}

// Convenience presets so "all Tuesday mornings" is one click.
const TIME_PRESETS = [
  { label: "All day", start: 0, end: 24 * 60 },
  { label: "Morning (6am–12pm)", start: 360, end: 720 },
  { label: "Afternoon (12pm–5pm)", start: 720, end: 1020 },
  { label: "Evening (5pm–10pm)", start: 1020, end: 1320 },
  { label: "Custom…", start: -1, end: -1 },
];

// Human label for a request in summaries (the short form: name if it has
// one), prefixed with its org — requests from ALL my orgs mix in one list.
function requestLabel(r: ApiAvailabilityRequest): string {
  const base = r.name || dateRangeLabel(r.startDate, r.endDate);
  return r.org ? `${r.org.name}: ${base}` : base;
}

// Dropdown label — always shows the requested date range (shorthand), and
// prefixes the custom name when there is one. Mirrors the Create tab.
// <option>s can't hold chips, so the org rides along as a text prefix.
function requestOptionLabel(r: ApiAvailabilityRequest): string {
  const range = shortRangeLabel(r.startDate, r.endDate);
  const base = r.name ? `${r.name} (${range})` : range;
  return r.org ? `${r.org.name} — ${base}` : base;
}

// Segmented-toggle button styling for the "Block out times" specific/recurring
// switch — filled when active, plain otherwise.
function blockKindClass(active: boolean): string {
  return `rounded-md px-3 py-1.5 font-medium transition-colors ${
    active
      ? "bg-indigo-600 text-white"
      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
  }`;
}

export default function SchedulePage() {
  const [entries, setEntries] = useState<ApiUnavailability[] | null>(null);
  const [requests, setRequests] = useState<ApiAvailabilityRequest[]>([]);
  const [responses, setResponses] = useState<AvailabilityResponse[]>([]);
  // The TimeRange the specific-blocks section is currently focused on.
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "specific" | "complete" | "block" | null
  >(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  // Submit opens a confirmation modal summarizing the days you'll be marked
  // unavailable for the selected request before it's actually sent.
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Inline error for the "Block out times" form (e.g. duplicate recurring).
  const [blockError, setBlockError] = useState<string | null>(null);

  // Unified "Block out times" form: a one-off specific date/range OR a weekly
  // recurring block. Both share the time-of-day picker.
  const [blockKind, setBlockKind] = useState<"specific" | "recurring">("specific");
  const [dayOfWeek, setDayOfWeek] = useState(2); // Tuesday (recurring)
  const [presetIndex, setPresetIndex] = useState(0); // All day
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("12:00");
  const [blockStart, setBlockStart] = useState(""); // specific range start
  const [blockEnd, setBlockEnd] = useState(""); // "" = single day

  // Admin-request response form: its own start/end date + time window, kept
  // separate from the general block form above.
  const [specDate, setSpecDate] = useState("");
  const [specEndDate, setSpecEndDate] = useState(""); // "" = single day
  const [specPresetIndex, setSpecPresetIndex] = useState(0); // All day
  const [specCustomStart, setSpecCustomStart] = useState("09:00");
  const [specCustomEnd, setSpecCustomEnd] = useState("12:00");

  const reload = useCallback(async () => {
    // On any error, fall back to empty state so the page renders instead of
    // hanging on the loader forever.
    try {
      const res = await fetch("/api/availability");
      const data = res.ok ? await res.json() : {};
      setEntries(data.entries ?? []);
      const reqs: ApiAvailabilityRequest[] = data.requests ?? [];
      setRequests(reqs);
      setResponses(data.responses ?? []);
      // Default the dropdown to the newest request (list is newest-first).
      setSelectedRequestId((prev) => prev || reqs[0]?.id || "");
    } catch {
      setEntries([]);
      setRequests([]);
      setResponses([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Unified block creator: a weekly recurring block, or a one-off specific
  // date/range — both carry the shared time window.
  async function addBlock(e: FormEvent) {
    e.preventDefault();
    setBlockError(null);

    if (blockKind === "recurring") {
      // Recurring carries a time-of-day window (from the preset / custom).
      const preset = TIME_PRESETS[presetIndex];
      const isCustom = preset.start === -1;
      const startMinute = isCustom ? timeStringToMinutes(customStart) : preset.start;
      const endMinute = isCustom ? timeStringToMinutes(customEnd) : preset.end;
      // Reject an exact duplicate up front (the server enforces this too).
      const isDuplicate = (entries ?? []).some(
        (entry) =>
          entry.type === "RECURRING" &&
          entry.dayOfWeek === dayOfWeek &&
          entry.startMinute === startMinute &&
          entry.endMinute === endMinute
      );
      if (isDuplicate) {
        setBlockError("That block already exists.");
        return;
      }
      setBusyAction("block");
      try {
        await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "RECURRING", dayOfWeek, startMinute, endMinute }),
        });
        await reload();
        window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
      } finally {
        setBusyAction(null);
      }
      return;
    }

    // Specific: a standalone (request-independent) single day or range, blocked
    // all day (0 → end of day). Leave endDate off for a single day.
    if (!blockStart) return;
    setBusyAction("block");
    try {
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SPECIFIC",
          date: blockStart,
          endDate: blockEnd && blockEnd !== blockStart ? blockEnd : undefined,
          startMinute: 0,
          endMinute: 24 * 60,
        }),
      });
      setBlockStart("");
      setBlockEnd("");
      await reload();
      window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
    } finally {
      setBusyAction(null);
    }
  }

  // A specific block: a start date (+ optional end date for a range) and a time
  // window, tied to the selected TimeRange.
  async function addSpecific(e: FormEvent) {
    e.preventDefault();
    if (!specDate || !selectedRequestId) return;
    setBusyAction("specific");
    try {
      const preset = TIME_PRESETS[specPresetIndex];
      const isCustom = preset.start === -1;
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SPECIFIC",
          requestId: selectedRequestId,
          date: specDate,
          // Only send endDate when it's a real, different day (a range).
          endDate: specEndDate && specEndDate !== specDate ? specEndDate : undefined,
          startMinute: isCustom
            ? timeStringToMinutes(specCustomStart)
            : preset.start,
          endMinute: isCustom ? timeStringToMinutes(specCustomEnd) : preset.end,
        }),
      });
      setSpecDate("");
      setSpecEndDate("");
      await reload();
    } finally {
      setBusyAction(null);
    }
  }

  // Edit a run of whole days straight from the calendar. `blocked` true paints
  // an all-day block over them (merging, never duplicating); false clears them
  // (splitting a covering range as needed). Handled server-side so it's atomic.
  async function editDays(startYmd: string, endYmd: string, blocked: boolean) {
    setBusyAction("specific");
    try {
      await fetch("/api/availability/block-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startYmd, end: endYmd, blocked }),
      });
      await reload();
      window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
    } finally {
      setBusyAction(null);
    }
  }

  async function remove(id: string) {
    setBusyEntryId(id);
    try {
      await fetch(`/api/availability/${id}`, { method: "DELETE" });
      await reload();
    } finally {
      setBusyEntryId(null);
    }
  }

  // Toggles the selected request's completion (creates ↔ deletes the row).
  async function toggleComplete() {
    if (!selectedRequestId) return;
    setBusyAction("complete");
    try {
      await fetch("/api/availability/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: selectedRequestId }),
      });
      await reload();
      // Clear/refresh the navbar reminder dot + banner right away.
      window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
    } finally {
      setBusyAction(null);
    }
  }

  // "All day" for a full-day window, else "9:00 AM – 12:00 PM". Keeps the list
  // from showing a confusing "12:00 AM – 12:00 AM" for all-day blocks.
  function timeWindowLabel(startMinute: number, endMinute: number): string {
    if (startMinute <= 0 && endMinute >= 24 * 60) return "All day";
    return `${minutesToTimeLabel(startMinute)} – ${minutesToTimeLabel(endMinute)}`;
  }

  // The read-only text for one block (used by both the resulting-union list and
  // the per-section lists).
  function entryText(entry: ApiUnavailability) {
    if (entry.type === "RECURRING") {
      return (
        <>
          Every <strong>{DAY_LABELS[entry.dayOfWeek!]}</strong>,{" "}
          {timeWindowLabel(entry.startMinute!, entry.endMinute!)}
        </>
      );
    }
    if (entry.type === "SPECIFIC") {
      const start = new Date(entry.startDate!).toLocaleDateString();
      // A range shows both endpoints; a single-day block shows just the date.
      const end =
        entry.endDate &&
        new Date(entry.endDate).toDateString() !==
          new Date(entry.startDate!).toDateString()
          ? new Date(entry.endDate).toLocaleDateString()
          : null;
      return (
        <>
          <strong>{start}</strong>
          {end && (
            <>
              {" – "}
              <strong>{end}</strong>
            </>
          )}
          , {timeWindowLabel(entry.startMinute!, entry.endMinute!)}
        </>
      );
    }
    return (
      <>
        <strong>{new Date(entry.startDate!).toLocaleDateString()}</strong> to{" "}
        <strong>{new Date(entry.endDate!).toLocaleDateString()}</strong>
        {entry.note && <span className="text-gray-500"> — {entry.note}</span>}
      </>
    );
  }

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(!entries);
  if (!entries) return null;

  const selectedRequest = requests.find((r) => r.id === selectedRequestId);
  const selectedResponse = responses.find(
    (r) => r.requestId === selectedRequestId
  );
  // Submitted = a response row with a completedAt (a null one is "unsubmitted").
  const submitted = !!selectedResponse?.completedAt;

  // The days I'll be marked unavailable for the selected request — shown in the
  // submit-confirmation modal.
  const confirmDays = selectedRequest
    ? blockedDaysInRange(entries, selectedRequest.startDate, selectedRequest.endDate)
    : [];

  // Bounds for the specific-block date pickers: stay inside the selected
  // request's window, and never allow marking a date in the past.
  const windowEnd = selectedRequest
    ? toYmd(new Date(selectedRequest.endDate))
    : undefined;
  const windowStart = selectedRequest
    ? toYmd(new Date(selectedRequest.startDate))
    : toYmd(new Date());
  const rangeMin =
    windowStart > toYmd(new Date()) ? windowStart : toYmd(new Date());

  // The Busy Blocks list: dated (specific) blocks first — only ones ending
  // today or later, so past blocks drop off — in chronological order, then the
  // recurring blocks by weekday. Deleting still targets the real entry id.
  const todayYmd = toYmd(new Date());
  const listEntries = [...entries]
    .filter((e) => {
      if (e.type === "RECURRING") return true;
      const end = e.endDate ?? e.startDate;
      return !end || toYmd(new Date(end)) >= todayYmd; // hide fully-past blocks
    })
    .sort((a, b) => {
      const aRec = a.type === "RECURRING";
      const bRec = b.type === "RECURRING";
      if (aRec !== bRec) return aRec ? 1 : -1; // specific/dated first, recurring last
      if (!aRec) {
        const ad = a.startDate ? new Date(a.startDate).getTime() : 0;
        const bd = b.startDate ? new Date(b.startDate).getTime() : 0;
        if (ad !== bd) return ad - bd;
        return (a.startMinute ?? 0) - (b.startMinute ?? 0);
      }
      // Both recurring: order by weekday, then start time.
      const ao = (a.dayOfWeek ?? 0) * 1440 + (a.startMinute ?? 0);
      const bo = (b.dayOfWeek ?? 0) * 1440 + (b.startMinute ?? 0);
      return ao - bo;
    });

  return (
    <div className="space-y-6">
      {/* Layout: desktop is two independent columns — editors (Admin Requests,
          then Block out times) on the left, Busy Blocks (calendar + list) on
          the right. Mobile is one column ordered Admin Requests → Busy Blocks →
          Block out times. The editors wrapper is `display: contents` on mobile
          so its two sections flatten into the parent and can be ordered around
          Busy Blocks; on desktop it's a normal column, so the two columns keep
          independent heights (no calendar-driven gap). */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="contents lg:block lg:min-w-0 lg:flex-1 lg:space-y-6">
          {/* ── 1. Admin Requests — respond to an admin's availability request ── */}
          <section data-tour="avail-editors" className="order-1 min-w-0 space-y-3">
            <h2 className="text-xl font-bold">Admin Requests</h2>
          {requests.length === 0 ? (
            <Card>
              <p className="text-sm text-gray-500">
                No one has requested availability yet. You can still block out
                any dates in <strong>Block out times</strong> below (or the
                calendar on desktop).
              </p>
            </Card>
          ) : (
            <Card className="space-y-4">
              <Select
                label="Responding to request"
                value={selectedRequestId}
                onChange={(e) => {
                  setSelectedRequestId(e.target.value);
                  setConfirmOpen(false);
                }}
              >
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {requestOptionLabel(r)}
                  </option>
                ))}
              </Select>

              {selectedRequest && (
                <>
                  {/* Which org is asking — the request list spans them all. */}
                  {selectedRequest.org && (
                    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                      {selectedRequest.org.name}
                    </span>
                  )}
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Block out the dates you <strong>can&rsquo;t</strong> serve
                    between{" "}
                    <strong>{shortDateLabel(selectedRequest.startDate)}</strong>{" "}
                    and{" "}
                    <strong>{shortDateLabel(selectedRequest.endDate)}</strong>,
                    then submit so the team knows you&rsquo;re done. If your
                    dates are already blocked correctly, just submit your
                    response.
                  </p>

                  {submitted ? (
                    /* Submitted: a clear confirmation + a way back to editing. */
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 px-3 py-2 dark:bg-green-900/30">
                      <p className="text-sm font-medium text-green-700 dark:text-green-300">
                        ✓ {selectedResponse!.edited ? "Updated" : "Submitted"} on{" "}
                        {new Date(
                          selectedResponse!.completedAt!
                        ).toLocaleDateString()}
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={toggleComplete}
                        disabled={busyAction === "complete"}
                      >
                        {busyAction === "complete" ? (
                          <LoadingDots size="sm" />
                        ) : (
                          "Make changes"
                        )}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Add a block within this request's window. "Block these
                          dates" is intentionally softer (secondary) so the
                          primary "Submit Response" below stands out. */}
                      <form
                        onSubmit={addSpecific}
                        className="grid gap-3 sm:grid-cols-2 sm:items-end"
                      >
                        <DateSelect
                          range
                          label="Dates to block"
                          value={specDate}
                          endValue={specEndDate}
                          min={rangeMin}
                          max={windowEnd}
                          dayMarker={(ymd) => dayBlockLevel(entries, ymd)}
                          onRangeChange={(start, end) => {
                            setSpecDate(start);
                            setSpecEndDate(end);
                          }}
                          required
                        />
                        <Select
                          label="Time"
                          value={specPresetIndex}
                          onChange={(e) =>
                            setSpecPresetIndex(Number(e.target.value))
                          }
                        >
                          {TIME_PRESETS.map((p, i) => (
                            <option key={i} value={i}>
                              {p.label}
                            </option>
                          ))}
                        </Select>
                        {TIME_PRESETS[specPresetIndex].start === -1 && (
                          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                            <Input
                              label="From"
                              type="time"
                              value={specCustomStart}
                              onChange={(e) => setSpecCustomStart(e.target.value)}
                            />
                            <Input
                              label="To"
                              type="time"
                              value={specCustomEnd}
                              onChange={(e) => setSpecCustomEnd(e.target.value)}
                            />
                          </div>
                        )}
                        <div className="sm:col-span-2">
                          <Button
                            type="submit"
                            variant="secondary"
                            disabled={!specDate || busyAction === "specific"}
                          >
                            {busyAction === "specific" ? (
                              <LoadingDots size="sm" />
                            ) : (
                              "Block these dates"
                            )}
                          </Button>
                        </div>
                      </form>

                      {/* Primary CTA — opens a confirmation modal summarizing
                          the days you'll be marked unavailable. */}
                      <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                        <Button
                          className="w-full"
                          onClick={() => setConfirmOpen(true)}
                          disabled={busyAction === "complete"}
                        >
                          {busyAction === "complete" ? (
                            <LoadingDots size="sm" />
                          ) : (
                            "Submit Response"
                          )}
                        </Button>
                      </div>
                    </>
                  )}
                </>
              )}
            </Card>
          )}
          </section>

          {/* Block out times — a one-off specific date/range OR a weekly
              recurring block, in one form. (Admin Requests above is only for
              responding to a request's window.) */}
          <section className="order-3 min-w-0 space-y-3">
            <h2 className="text-xl font-bold">Block out times</h2>
            <Card className="space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Block times you <strong>can&rsquo;t</strong> serve — a specific
                date or range, or a weekly repeat.
              </p>

              {/* Recurring (left) vs. specific (right) toggle. */}
              <div className="inline-flex rounded-lg border border-gray-300 p-0.5 text-sm dark:border-gray-600">
                <button
                  type="button"
                  onClick={() => setBlockKind("recurring")}
                  className={blockKindClass(blockKind === "recurring")}
                >
                  Every week
                </button>
                <button
                  type="button"
                  onClick={() => setBlockKind("specific")}
                  className={blockKindClass(blockKind === "specific")}
                >
                  Specific date(s)
                </button>
              </div>

              {blockKind === "recurring" ? (
                // Weekly recurring: a weekday + a time-of-day window.
                <form
                  onSubmit={addBlock}
                  className="grid gap-3 sm:grid-cols-2 sm:items-end"
                >
                  <Select
                    label="Day of week"
                    value={dayOfWeek}
                    onChange={(e) => setDayOfWeek(Number(e.target.value))}
                  >
                    {DAY_LABELS.map((label, i) => (
                      <option key={i} value={i}>
                        {label}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label="Time"
                    value={presetIndex}
                    onChange={(e) => setPresetIndex(Number(e.target.value))}
                  >
                    {TIME_PRESETS.map((p, i) => (
                      <option key={i} value={i}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                  {TIME_PRESETS[presetIndex].start === -1 && (
                    <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                      <Input
                        label="From"
                        type="time"
                        value={customStart}
                        onChange={(e) => setCustomStart(e.target.value)}
                      />
                      <Input
                        label="To"
                        type="time"
                        value={customEnd}
                        onChange={(e) => setCustomEnd(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="sm:col-span-2">
                    <Button type="submit" disabled={busyAction === "block"}>
                      {busyAction === "block" ? (
                        <LoadingDots size="sm" />
                      ) : (
                        "Add recurring block"
                      )}
                    </Button>
                  </div>
                  {blockError && (
                    <p className="text-sm text-rose-600 sm:col-span-2 dark:text-rose-400">
                      {blockError}
                    </p>
                  )}
                </form>
              ) : (
                // Specific: a single day or a range, blocked all day (no time).
                <form onSubmit={addBlock} className="space-y-3">
                  <DateSelect
                    range
                    label="Dates to block"
                    value={blockStart}
                    endValue={blockEnd}
                    min={toYmd(new Date())}
                    dayMarker={(ymd) => dayBlockLevel(entries, ymd)}
                    onRangeChange={(start, end) => {
                      setBlockStart(start);
                      setBlockEnd(end);
                    }}
                    required
                  />
                  <Button
                    type="submit"
                    disabled={!blockStart || busyAction === "block"}
                  >
                    {busyAction === "block" ? (
                      <LoadingDots size="sm" />
                    ) : (
                      "Block these dates"
                    )}
                  </Button>
                </form>
              )}
            </Card>
          </section>
        </div>

        {/* Busy Blocks — single source of truth for viewing/deleting.
            Desktop: calendar + list; mobile: list only (no calendar). */}
        <div className="order-2 min-w-0 space-y-3 lg:flex-1">
          <h2 className="text-xl font-bold">Busy Blocks</h2>
          {/* Calendar is desktop-only — too cramped on a phone. */}
          <div data-tour="avail-calendar" className="hidden lg:block">
            <AvailabilityCalendar
              entries={entries}
              onEditDays={editDays}
              busy={busyAction === "specific"}
            />
          </div>
          <Card className="max-h-80 overflow-y-auto">
            {listEntries.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nothing blocked yet — you&rsquo;re available anytime.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {listEntries.map((entry) => {
                  const req =
                    entry.type === "SPECIFIC"
                      ? requests.find((r) => r.id === entry.requestId)
                      : undefined;
                  return (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <Badge tone={entry.type === "SPECIFIC" ? "blue" : "gray"}>
                          {entry.type === "SPECIFIC" ? "Specific" : "Recurring"}
                        </Badge>
                        <span>
                          {entryText(entry)}
                          {req && (
                            <span className="text-gray-500">
                              {" "}
                              — {requestLabel(req)}
                            </span>
                          )}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        className="shrink-0"
                        onClick={() => remove(entry.id)}
                        disabled={busyEntryId === entry.id}
                      >
                        {busyEntryId === entry.id ? (
                          <LoadingDots size="sm" />
                        ) : (
                          "Delete"
                        )}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Submit-response confirmation modal: summarizes the days you'll be
          marked unavailable before actually sending. Modify (left) closes it;
          Confirm (right) submits. */}
      {confirmOpen && selectedRequest && (
        <Modal
          open
          onClose={() => setConfirmOpen(false)}
          title="Submit your response?"
          subtitle={requestLabel(selectedRequest)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setConfirmOpen(false)}
                disabled={busyAction === "complete"}
              >
                Modify
              </Button>
              <Button
                onClick={async () => {
                  await toggleComplete();
                  setConfirmOpen(false);
                }}
                disabled={busyAction === "complete"}
              >
                {busyAction === "complete" ? (
                  <LoadingDots size="sm" />
                ) : (
                  "Confirm"
                )}
              </Button>
            </>
          }
        >
          {confirmDays.length === 0 ? (
            <p className="text-sm text-gray-700 dark:text-gray-300">
              You haven&rsquo;t blocked any dates, so you&rsquo;ll be marked{" "}
              <strong>available the whole time</strong> (
              {shortDateLabel(selectedRequest.startDate)} –{" "}
              {shortDateLabel(selectedRequest.endDate)}).
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-700 dark:text-gray-300">
                You&rsquo;ll be marked <strong>unavailable</strong> on these days
                ({shortDateLabel(selectedRequest.startDate)} –{" "}
                {shortDateLabel(selectedRequest.endDate)}):
              </p>
              <ul className="space-y-1.5 text-sm">
                {confirmDays.map((d) => (
                  <li key={d.ymd} className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        d.level === "full" ? "bg-rose-500" : "bg-amber-500"
                      }`}
                    />
                    <span className="font-medium">{d.label}</span>
                    <span className="text-gray-500 dark:text-gray-400">
                      — {d.level === "full" ? "All day" : "Part of the day"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
