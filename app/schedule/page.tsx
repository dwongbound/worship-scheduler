"use client";
// Availabilities tab: tell the scheduler when you're NOT free.
//   • Specific blocks — a date (or date range) + time window inside a TimeRange
//     the admin requested.
//   • Recurring blocks — weekly ("every Tuesday morning"), always apply.
// Layout is a split pane. The "Busy Blocks" column is the single source of
// truth for viewing/deleting: the union of both block types as a calendar plus
// one scrollable, deletable list. The editors column holds the two forms.
//   Desktop: editors LEFT, Busy Blocks RIGHT.
//   Mobile:  Busy Blocks list on top (calendar hidden), editors below.
import { FormEvent, useCallback, useEffect, useState } from "react";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import Select from "@/components/common/Select";
import { AVAILABILITY_CHANGED_EVENT } from "@/components/Navbar";
import { DAY_LABELS } from "@/lib/constants";
import {
  formatDay,
  minutesToTimeLabel,
  shortDateLabel,
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
  const base = r.name || `${formatDay(r.startDate)} → ${formatDay(r.endDate)}`;
  return r.org ? `${r.org.name}: ${base}` : base;
}

// Dropdown label — always shows the requested date range (shorthand), and
// prefixes the custom name when there is one. Mirrors the Create tab.
// <option>s can't hold chips, so the org rides along as a text prefix.
function requestOptionLabel(r: ApiAvailabilityRequest): string {
  const range = `${shortDateLabel(r.startDate)} - ${shortDateLabel(r.endDate)}`;
  const base = r.name ? `${r.name} (${range})` : range;
  return r.org ? `${r.org.name} — ${base}` : base;
}

export default function SchedulePage() {
  const [entries, setEntries] = useState<ApiUnavailability[] | null>(null);
  const [requests, setRequests] = useState<ApiAvailabilityRequest[]>([]);
  const [responses, setResponses] = useState<AvailabilityResponse[]>([]);
  // The TimeRange the specific-blocks section is currently focused on.
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "recurring" | "specific" | "complete" | null
  >(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);
  // Two-step guard when submitting with nothing blocked (see the submit area).
  const [confirmingEmptySubmit, setConfirmingEmptySubmit] = useState(false);

  // Inline error for the general-block form (e.g. duplicate block).
  const [recurringError, setRecurringError] = useState<string | null>(null);

  // Recurring block form state
  const [dayOfWeek, setDayOfWeek] = useState(2); // Tuesday
  const [presetIndex, setPresetIndex] = useState(1); // Morning
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("12:00");

  // Specific block form state (a start date, optional end date, + time window)
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

  async function addRecurring(e: FormEvent) {
    e.preventDefault();
    setRecurringError(null);
    const preset = TIME_PRESETS[presetIndex];
    const isCustom = preset.start === -1;
    const startMinute = isCustom ? timeStringToMinutes(customStart) : preset.start;
    const endMinute = isCustom ? timeStringToMinutes(customEnd) : preset.end;
    // Reject an exact duplicate before hitting the server so the list can't
    // accumulate identical rows (the server enforces this too).
    const isDuplicate = (entries ?? []).some(
      (entry) =>
        entry.type === "RECURRING" &&
        entry.dayOfWeek === dayOfWeek &&
        entry.startMinute === startMinute &&
        entry.endMinute === endMinute
    );
    if (isDuplicate) {
      setRecurringError("That block already exists.");
      return;
    }
    setBusyAction("recurring");
    try {
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "RECURRING", dayOfWeek, startMinute, endMinute }),
      });
      await reload();
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

  // Block a run of whole days straight from the calendar — a standalone,
  // all-day specific block that isn't tied to any request.
  async function blockDays(startYmd: string, endYmd: string) {
    setBusyAction("specific");
    try {
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "SPECIFIC",
          date: startYmd,
          endDate: endYmd !== startYmd ? endYmd : undefined,
          startMinute: 0,
          endMinute: 24 * 60, // all day
        }),
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

  // How many of my blocks actually apply to this request's window — so the UI
  // can show progress and warn before submitting "available the whole time".
  // Recurring blocks always apply; specific blocks count when they land inside
  // the window (whether entered here or dragged on the calendar).
  const blocksForRequest = selectedRequest
    ? entries.filter((e) => {
        if (e.type === "RECURRING") return true;
        if (!e.startDate) return false;
        const day = toYmd(new Date(e.startDate));
        return (
          day >= toYmd(new Date(selectedRequest.startDate)) &&
          day <= toYmd(new Date(selectedRequest.endDate))
        );
      }).length
    : 0;

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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Availabilities</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Block out the times you <strong>can&rsquo;t</strong> serve — the
          auto-scheduler won&rsquo;t assign you then. Block{" "}
          <strong>specific dates</strong> (one-off, or in response to a
          request) or set <strong>recurring blocks</strong> that repeat every
          week. The quickest way is to click or drag days on the calendar.
        </p>
      </div>

      {/* Split pane: editors on the left, resulting-union preview on the right
          (the right column is desktop-only — hidden on mobile). */}
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* ── Editors: desktop LEFT, mobile BELOW the Busy Blocks list ── */}
        <div className="order-2 min-w-0 flex-1 space-y-6 lg:order-1">
          {/* Specific dates: respond to an admin's availability request by
              blocking out the dates you can't serve, then submit. */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold">Block specific dates</h2>
            {requests.length === 0 ? (
              <Card>
                <p className="text-sm text-gray-500">
                  No one has requested availability yet. You can still block out
                  any dates using the calendar on the right.
                </p>
              </Card>
            ) : (
              <Card className="space-y-4">
                <Select
                  label="Responding to request"
                  value={selectedRequestId}
                  onChange={(e) => {
                    setSelectedRequestId(e.target.value);
                    setConfirmingEmptySubmit(false);
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
                      then submit so the team knows you&rsquo;re done.
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
                        {/* Add a block within this request's window. Leave "End
                            date" blank for a single day; set it for a range. */}
                        <form
                          onSubmit={addSpecific}
                          className="grid gap-3 sm:grid-cols-2 sm:items-end"
                        >
                          <DateSelect
                            label="Start date"
                            value={specDate}
                            min={rangeMin}
                            max={windowEnd}
                            onChange={(v) => {
                              setSpecDate(v);
                              // Keep the range valid: drop an end date before start.
                              if (specEndDate && specEndDate < v)
                                setSpecEndDate("");
                            }}
                            required
                          />
                          <DateSelect
                            label="End date (optional)"
                            value={specEndDate}
                            min={specDate || rangeMin}
                            max={windowEnd}
                            onChange={setSpecEndDate}
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
                                onChange={(e) =>
                                  setSpecCustomStart(e.target.value)
                                }
                              />
                              <Input
                                label="To"
                                type="time"
                                value={specCustomEnd}
                                onChange={(e) =>
                                  setSpecCustomEnd(e.target.value)
                                }
                              />
                            </div>
                          )}
                          <div className="sm:col-span-2">
                            <Button
                              type="submit"
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

                        {/* Submit: only after you've entered your blocks. We
                            show a running count and, if nothing is blocked,
                            confirm you really mean "available the whole time"
                            (testers tended to submit an empty response). */}
                        <div className="border-t border-gray-200 pt-4 dark:border-gray-700">
                          {confirmingEmptySubmit ? (
                            <div className="space-y-2">
                              <p className="text-sm text-gray-700 dark:text-gray-300">
                                You haven&rsquo;t blocked any dates for this
                                request, so you&rsquo;ll be marked{" "}
                                <strong>available the whole time</strong> (
                                {shortDateLabel(selectedRequest.startDate)} –{" "}
                                {shortDateLabel(selectedRequest.endDate)}). Sound
                                right?
                              </p>
                              <div className="flex flex-wrap justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setConfirmingEmptySubmit(false)}
                                  disabled={busyAction === "complete"}
                                >
                                  Go back
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setConfirmingEmptySubmit(false);
                                    toggleComplete();
                                  }}
                                  disabled={busyAction === "complete"}
                                >
                                  {busyAction === "complete" ? (
                                    <LoadingDots size="sm" />
                                  ) : (
                                    "Yes, I'm fully available"
                                  )}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {blocksForRequest === 0
                                  ? "Step 1: block the dates you can't serve above. Nothing blocked yet."
                                  : `${blocksForRequest} block${
                                      blocksForRequest === 1 ? "" : "s"
                                    } added — submit when you're done.`}
                              </span>
                              <Button
                                size="sm"
                                onClick={() =>
                                  blocksForRequest === 0
                                    ? setConfirmingEmptySubmit(true)
                                    : toggleComplete()
                                }
                                disabled={busyAction === "complete"}
                              >
                                {busyAction === "complete" ? (
                                  <LoadingDots size="sm" />
                                ) : (
                                  "Submit unavailabilities"
                                )}
                              </Button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </>
                )}
              </Card>
            )}
          </section>

          {/* Recurring blocks: apply every week */}
          <section className="space-y-3">
            <h2 className="text-xl font-bold">Recurring blocks</h2>
            <Card>
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                Recurring — applies every week.
              </p>
              <form
                onSubmit={addRecurring}
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
                  <Button type="submit" disabled={busyAction === "recurring"}>
                    {busyAction === "recurring" ? (
                      <LoadingDots size="sm" />
                    ) : (
                      "Add recurring block"
                    )}
                  </Button>
                </div>
                {recurringError && (
                  <p className="text-sm text-rose-600 sm:col-span-2 dark:text-rose-400">
                    {recurringError}
                  </p>
                )}
              </form>
            </Card>
          </section>
        </div>

        {/* ── Busy Blocks — single source of truth for viewing/deleting.
            Desktop RIGHT (calendar + list); mobile TOP (list only). ────── */}
        <div className="order-1 min-w-0 flex-1 space-y-3 lg:order-2">
          <h2 className="text-xl font-bold">Busy Blocks</h2>
          {/* Calendar is desktop-only — too cramped on a phone. */}
          <div className="hidden lg:block">
            <AvailabilityCalendar
              entries={entries}
              onBlockDays={blockDays}
              busy={busyAction === "specific"}
            />
          </div>
          <Card className="max-h-80 overflow-y-auto">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nothing blocked yet — you&rsquo;re available anytime.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {entries.map((entry) => {
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
                        <Badge
                          tone={entry.type === "SPECIFIC" ? "blue" : "gray"}
                        >
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
    </div>
  );
}
