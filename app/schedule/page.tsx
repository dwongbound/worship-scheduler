"use client";
// Availabilities tab: tell the scheduler when you're NOT free over the next
// 3 months — recurring weekly blocks ("every Tuesday morning") or one-off
// date ranges ("Jan 5–10"). Then mark scheduling complete so admins know.
import { FormEvent, useCallback, useEffect, useState } from "react";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import Select from "@/components/common/Select";
import { AVAILABILITY_CHANGED_EVENT } from "@/components/Navbar";
import { DAY_LABELS } from "@/lib/constants";
import { formatDay, minutesToTimeLabel, timeStringToMinutes } from "@/lib/dates";
import type { ApiAvailabilityRequest, ApiUnavailability } from "@/lib/types";

// Convenience presets so "all Tuesday mornings" is one click.
const TIME_PRESETS = [
  { label: "All day", start: 0, end: 24 * 60 },
  { label: "Morning (6am–12pm)", start: 360, end: 720 },
  { label: "Afternoon (12pm–5pm)", start: 720, end: 1020 },
  { label: "Evening (5pm–10pm)", start: 1020, end: 1320 },
  { label: "Custom…", start: -1, end: -1 },
];

export default function SchedulePage() {
  const [entries, setEntries] = useState<ApiUnavailability[] | null>(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [request, setRequest] = useState<ApiAvailabilityRequest | null>(null);
  const [needsResponse, setNeedsResponse] = useState(false);
  // Which control is mid-update (inline dots) — never a full-page loader.
  const [busyAction, setBusyAction] = useState<
    "recurring" | "range" | "complete" | null
  >(null);
  const [busyEntryId, setBusyEntryId] = useState<string | null>(null);

  // Recurring form state
  const [dayOfWeek, setDayOfWeek] = useState(2); // Tuesday
  const [presetIndex, setPresetIndex] = useState(1); // Morning
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("12:00");

  // Date-range form state
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rangeNote, setRangeNote] = useState("");

  const reload = useCallback(async () => {
    // On any error, fall back to empty state so the page renders instead of
    // hanging on the loader forever.
    try {
      const [availRes, reqRes] = await Promise.all([
        fetch("/api/availability"),
        fetch("/api/availability-request"),
      ]);
      const avail = availRes.ok ? await availRes.json() : {};
      const req = reqRes.ok ? await reqRes.json() : {};
      setEntries(avail.entries ?? []);
      setCompletedAt(avail.scheduleCompletedAt ?? null);
      setRequest(req.request ?? null);
      setNeedsResponse(!!req.needsResponse);
    } catch {
      setEntries([]);
      setCompletedAt(null);
      setRequest(null);
      setNeedsResponse(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function addRecurring(e: FormEvent) {
    e.preventDefault();
    setBusyAction("recurring");
    try {
      const preset = TIME_PRESETS[presetIndex];
      const isCustom = preset.start === -1;
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "RECURRING",
          dayOfWeek,
          startMinute: isCustom ? timeStringToMinutes(customStart) : preset.start,
          endMinute: isCustom ? timeStringToMinutes(customEnd) : preset.end,
        }),
      });
      await reload();
    } finally {
      setBusyAction(null);
    }
  }

  async function addRange(e: FormEvent) {
    e.preventDefault();
    if (!rangeStart || !rangeEnd) return;
    setBusyAction("range");
    try {
      await fetch("/api/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "DATE_RANGE",
          startDate: rangeStart,
          endDate: rangeEnd,
          note: rangeNote || null,
        }),
      });
      setRangeStart("");
      setRangeEnd("");
      setRangeNote("");
      await reload();
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

  // Toggles scheduleCompletedAt (set ↔ clear).
  async function toggleComplete() {
    setBusyAction("complete");
    try {
      await fetch("/api/availability/complete", { method: "POST" });
      await reload();
      // Clear/refresh the navbar reminder dot + banner right away.
      window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
    } finally {
      setBusyAction(null);
    }
  }

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(!entries);
  if (!entries) return null;

  // No active request from an admin: nothing for the user to do here.
  if (!request) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Availabilities</h1>
        <Card>
          <p className="text-gray-600 dark:text-gray-400">
            No availability input needed as of now.
          </p>
        </Card>
      </div>
    );
  }

  // `needsResponse` is false once the user has marked complete for THIS
  // request — that drives the badge, button, and the navbar reminder.
  const responded = !needsResponse;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Availabilities</h1>

      {request && (
        <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
          {request.name ? (
            <>
              {request.name} — {formatDay(request.startDate)} →{" "}
              {formatDay(request.endDate)}.
            </>
          ) : (
            <>
              Availability requested for {formatDay(request.startDate)} →{" "}
              {formatDay(request.endDate)}.
            </>
          )}
        </p>
      )}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Add the times you are <strong>not</strong> available over the next 3
        months. The auto-scheduler will avoid them.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Recurring weekly block */}
        <Card>
          <h2 className="mb-3 font-semibold">Recurring weekly</h2>
          <form onSubmit={addRecurring} className="space-y-3">
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
              <div className="grid grid-cols-2 gap-3">
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
            <Button type="submit" disabled={busyAction === "recurring"}>
              {busyAction === "recurring" ? (
                <LoadingDots size="sm" />
              ) : (
                "Add recurring block"
              )}
            </Button>
          </form>
        </Card>

        {/* One-off date range */}
        <Card>
          <h2 className="mb-3 font-semibold">Date range</h2>
          <form onSubmit={addRange} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="From"
                type="date"
                value={rangeStart}
                onChange={(e) => setRangeStart(e.target.value)}
                required
              />
              <Input
                label="To"
                type="date"
                value={rangeEnd}
                onChange={(e) => setRangeEnd(e.target.value)}
                required
              />
            </div>
            <Input
              label="Note (optional)"
              value={rangeNote}
              onChange={(e) => setRangeNote(e.target.value)}
              placeholder="e.g. Out of town"
            />
            <Button type="submit" disabled={busyAction === "range"}>
              {busyAction === "range" ? (
                <LoadingDots size="sm" />
              ) : (
                "Add date range"
              )}
            </Button>
          </form>
        </Card>
      </div>

      {/* Existing entries */}
      <section>
        <h2 className="mb-3 text-xl font-bold">My unavailable times</h2>
        {entries.length === 0 && (
          <p className="text-gray-500">
            Nothing yet — you're available anytime.
          </p>
        )}
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Card className="flex items-center justify-between py-3">
                <span className="text-sm">
                  {entry.type === "RECURRING" ? (
                    <>
                      Every <strong>{DAY_LABELS[entry.dayOfWeek!]}</strong>,{" "}
                      {minutesToTimeLabel(entry.startMinute!)} –{" "}
                      {minutesToTimeLabel(entry.endMinute!)}
                    </>
                  ) : (
                    <>
                      <strong>
                        {new Date(entry.startDate!).toLocaleDateString()}
                      </strong>{" "}
                      to{" "}
                      <strong>
                        {new Date(entry.endDate!).toLocaleDateString()}
                      </strong>
                      {entry.note && (
                        <span className="text-gray-500"> — {entry.note}</span>
                      )}
                    </>
                  )}
                </span>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => remove(entry.id)}
                  disabled={busyEntryId === entry.id}
                >
                  {busyEntryId === entry.id ? (
                    <LoadingDots size="sm" />
                  ) : (
                    "Delete"
                  )}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* Done bar: once you've entered your unavailable times, mark scheduling
          complete so admins know. Lives at the bottom — the last step. */}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-6 dark:border-gray-700">
        {responded && completedAt && (
          <Badge tone="green">
            Completed {new Date(completedAt).toLocaleDateString()}
          </Badge>
        )}
        <Button
          variant={responded ? "secondary" : "primary"}
          onClick={toggleComplete}
          disabled={busyAction === "complete"}
        >
          {busyAction === "complete" ? (
            <LoadingDots size="sm" />
          ) : responded ? (
            "Mark as not complete"
          ) : (
            "I'm done scheduling"
          )}
        </Button>
      </div>
    </div>
  );
}
