"use client";
// Availabilities tab: tell the scheduler when you're NOT free.
//
// Two stacked sections, in the order the questions actually arrive:
//   1. Requests — one card per availability request across every org, each
//      showing whether you still owe an answer. Picking one doesn't navigate:
//      it LENSES the calendar below onto that request's window (rings its days,
//      dims the rest) and puts Submit on the card. A Todo / All switch decides
//      which cards are listed; Todo (the default) hides the ones you've already
//      answered, so the section reads as a to-do list.
//   2. My availability — the standing picture that ANSWERS those requests: the
//      calendar (click/drag to block whole days), the deletable list of blocks,
//      and the only form that creates them (a specific date/range, or weekly
//      recurring — any weekdays × any time windows in one go).
//
// The two are one page rather than two tabs on purpose: a request is answered
// out of the same blocks section 2 manages, so separating them would mean
// flipping back and forth to answer confidently. Blocks are global to the
// person — they apply to every org and every request.
import { FormEvent, useCallback, useEffect, useState } from "react";
import AvailabilityCalendar from "@/components/AvailabilityCalendar";
import WeekStrip from "@/components/WeekStrip";
import Badge from "@/components/common/Badge";
import Button from "@/components/common/Button";
import Card from "@/components/common/Card";
import Checkbox from "@/components/common/Checkbox";
import DateSelect, { toYmd } from "@/components/common/DateSelect";
import InfoTooltip from "@/components/common/InfoTooltip";
import Input from "@/components/common/Input";
import LoadingDots from "@/components/common/LoadingDots";
import { usePageLoading } from "@/components/LoadingProvider";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import { AVAILABILITY_CHANGED_EVENT } from "@/components/Navbar";
import {
  applyDayEdit,
  blockedDaysInRange,
  dayBlockLevel,
  expandRecurringBlocks,
  mergeWindows,
  isOptimisticId,
  weeksFromToday,
} from "@/lib/availability";
import { DAY_LABELS } from "@/lib/constants";
import {
  dateRangeLabel,
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
  { label: "Custom", start: -1, end: -1 },
];

// The two exclusive presets. Each already defines the whole window on its own
// — "All day" IS every hour, "Custom" is one span picked by hand — so ticking
// either switches the rest off (and disables them) until it's unticked.
// Morning/Afternoon/Evening are the ones that stack with each other.
const CUSTOM_PRESET = TIME_PRESETS.findIndex((p) => p.start === -1);
const ALL_DAY_PRESET = TIME_PRESETS.findIndex(
  (p) => p.start === 0 && p.end === 24 * 60
);
const EXCLUSIVE_PRESETS = [ALL_DAY_PRESET, CUSTOM_PRESET];

// How long a recurring block keeps repeating. "Forever" is the default — the
// other two stamp a stop date (endDate) on each block.
const REPEAT_OPTIONS: { value: "forever" | "weeks" | "until"; label: string }[] = [
  { value: "forever", label: "Forever" },
  { value: "weeks", label: "For a number of weeks" },
  { value: "until", label: "Until a date" },
];

// Human label for a request in summaries (the short form: name if it has
// one), prefixed with its org — requests from ALL my orgs mix in one list.
function requestLabel(r: ApiAvailabilityRequest): string {
  const base = r.name || dateRangeLabel(r.startDate, r.endDate);
  return r.org ? `${r.org.name}: ${base}` : base;
}

// Tab styling for the "Block out times" recurring/specific switch. An underline
// rather than a filled pill: it sits directly under the panel's own title, so
// it should read as chrome the way the calendar's header does, not as a control
// competing with the chips below it.
function blockKindClass(active: boolean): string {
  return `-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
    active
      ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300"
      : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:border-gray-600 dark:hover:text-gray-200"
  }`;
}

// One half of the Requests "Todo / All" switch. Same bordered-box-with-
// dividers shape as the weekday strip below, so the page has one segmented
// look rather than a second style of small filter.
function requestTabClass(active: boolean): string {
  return `flex items-center gap-1.5 border-l border-gray-300 px-3 py-1.5 text-sm font-medium transition-colors first:border-l-0 dark:border-gray-600 ${
    active
      ? "bg-indigo-600 text-white"
      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
  }`;
}

// One cell of the weekday strip. The seven live inside a single bordered box
// with hairline dividers, so the control reads as one field in a form of
// fields — and echoes the calendar's day grid — instead of seven loose pills.
function dayCellClass(active: boolean): string {
  return `flex-1 border-l border-gray-300 py-2 text-sm font-medium transition-colors first:border-l-0 dark:border-gray-600 ${
    active
      ? "bg-indigo-600 text-white"
      : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
  }`;
}

// Add/remove one value from a multi-select list.
function toggled(values: number[], value: number): number[] {
  return values.includes(value)
    ? values.filter((v) => v !== value)
    : [...values, value];
}

// The time-of-day picker, shared by both block kinds. These are independent
// windows you tick — a checkbox list says that plainly, where a row of pills
// left "All day" looking like a peer of "Morning" instead of the superset it
// is. Custom carries its own From/To inline on its row.
function TimeWindowPicker({
  selected,
  onToggle,
  customStart,
  customEnd,
  onCustomStart,
  onCustomEnd,
}: {
  selected: number[];
  onToggle: (index: number) => void;
  customStart: string;
  customEnd: string;
  onCustomStart: (value: string) => void;
  onCustomEnd: (value: string) => void;
}) {
  // Whichever exclusive preset is ticked, if any, is the only one selectable.
  // (indexOf, not a truthiness check — "All day" is index 0.)
  const locked = selected.find((i) => EXCLUSIVE_PRESETS.includes(i));
  return (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
        Times
      </legend>
      <div className="space-y-2">
        {TIME_PRESETS.map((preset, i) => {
          const off = locked !== undefined && i !== locked;
          const isCustom = i === CUSTOM_PRESET;
          return (
            <div
              key={preset.label}
              // Wraps so Custom's From/To drop to their own line on a narrow
              // phone rather than squeezing the two fields to nothing.
              className="flex flex-wrap items-center gap-x-3 gap-y-2"
            >
              <Checkbox
                label={preset.label}
                checked={selected.includes(i)}
                disabled={off}
                onChange={() => onToggle(i)}
              />
              {isCustom && locked === CUSTOM_PRESET && (
                // type="time" is what hands a phone its native time picker
                // (iOS's wheel, Android's dial) — nothing here overrides it.
                // The 16px font on small screens is the other half of that:
                // iOS Safari zooms the whole page in on focusing any input
                // under 16px, and never zooms back out.
                <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <Input
                    label="From"
                    hideLabel
                    type="time"
                    value={customStart}
                    onChange={(e) => onCustomStart(e.target.value)}
                    className="w-auto py-1.5 text-base sm:py-1 sm:text-sm"
                  />
                  to
                  <Input
                    label="To"
                    hideLabel
                    type="time"
                    value={customEnd}
                    onChange={(e) => onCustomEnd(e.target.value)}
                    className="w-auto py-1.5 text-base sm:py-1 sm:text-sm"
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function SchedulePage() {
  const [entries, setEntries] = useState<ApiUnavailability[] | null>(null);
  const [requests, setRequests] = useState<ApiAvailabilityRequest[]>([]);
  const [responses, setResponses] = useState<AvailabilityResponse[]>([]);
  // The TimeRange the specific-blocks section is currently focused on.
  const [selectedRequestId, setSelectedRequestId] = useState<string>("");
  // Which requests the list shows. "todo" is the default because this section
  // is a to-do list first — once you've answered a request it's history, and
  // leaving it in the list only makes the ones you still owe harder to find.
  const [requestFilter, setRequestFilter] = useState<"todo" | "all">("todo");
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
  // Explains a right-click "clear these days" that couldn't fully free them
  // because a weekly repeat still covers some (see editDays).
  const [clearNote, setClearNote] = useState<string | null>(null);

  // Unified "Block out times" form: a one-off specific date/range OR a weekly
  // recurring block. Both share the time-of-day picker.
  const [blockKind, setBlockKind] = useState<"specific" | "recurring">("specific");
  // Recurring is multi-select on both axes: any set of weekdays crossed with
  // any set of time windows, so "Mon–Fri mornings + afternoons" is one submit.
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([2]); // Tuesday
  const [presetIndexes, setPresetIndexes] = useState<number[]>([ALL_DAY_PRESET]);
  // How long the recurring blocks keep repeating: forever (default), a number
  // of weeks from today, or up to a date you pick.
  const [repeats, setRepeats] = useState<"forever" | "weeks" | "until">("forever");
  const [repeatWeeks, setRepeatWeeks] = useState("4");
  const [repeatUntil, setRepeatUntil] = useState("");
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("12:00");
  const [blockStart, setBlockStart] = useState(""); // specific range start
  const [blockEnd, setBlockEnd] = useState(""); // "" = single day

  const reload = useCallback(async () => {
    // On any error, fall back to empty state so the page renders instead of
    // hanging on the loader forever.
    try {
      const res = await fetch("/api/availability");
      const data = res.ok ? await res.json() : {};
      setEntries(data.entries ?? []);
      const reqs: ApiAvailabilityRequest[] = data.requests ?? [];
      setRequests(reqs);
      const resps: AvailabilityResponse[] = data.responses ?? [];
      setResponses(resps);
      // Open on the first request that still owes an answer — that's what
      // someone came here to do. Everything already sent (or nothing asked)
      // means no filter at all: the calendar shows the whole picture.
      setSelectedRequestId((prev) => {
        if (prev) return prev; // keep whatever the user picked
        const owed = reqs.find(
          (r) => !resps.some((x) => x.requestId === r.id && x.completedAt)
        );
        return owed?.id ?? "";
      });
    } catch {
      setEntries([]);
      setRequests([]);
      setResponses([]);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Pick/unpick one time window. An exclusive preset replaces whatever was
  // picked; the part-of-day ones stack with each other.
  function toggleWindow(index: number) {
    setPresetIndexes((prev) => {
      if (prev.includes(index)) return prev.filter((v) => v !== index);
      return EXCLUSIVE_PRESETS.includes(index) ? [index] : [...prev, index];
    });
  }

  // Unified block creator: a weekly recurring block, or a one-off specific
  // date/range — both carry the shared time window.
  async function addBlock(e: FormEvent) {
    e.preventDefault();
    setBlockError(null);

    if (blockKind === "recurring") {
      // Every selected weekday × every selected time window, with touching
      // windows merged (morning + afternoon = one 6am–5pm block).
      const windows = presetIndexes.map((i) => {
        const preset = TIME_PRESETS[i];
        return preset.start === -1
          ? {
              startMinute: timeStringToMinutes(customStart),
              endMinute: timeStringToMinutes(customEnd),
            }
          : { startMinute: preset.start, endMinute: preset.end };
      });
      if (windows.some((w) => w.startMinute >= w.endMinute)) {
        setBlockError("The custom end time must be after the start time.");
        return;
      }
      // Where the repeat stops: null = forever.
      let endDate: string | null = null;
      if (repeats === "weeks") {
        const weeks = Number(repeatWeeks);
        if (!Number.isFinite(weeks) || weeks < 1) {
          setBlockError("Enter how many weeks these blocks should repeat for.");
          return;
        }
        endDate = weeksFromToday(weeks);
      } else if (repeats === "until") {
        if (!repeatUntil) {
          setBlockError("Pick the last day these blocks should repeat.");
          return;
        }
        endDate = repeatUntil;
      }
      const blocks = expandRecurringBlocks(daysOfWeek, windows, endDate);
      // Drop the ones already stored (the server skips them too) so the
      // message is accurate when everything picked is a repeat.
      const fresh = blocks.filter(
        (block) =>
          !(entries ?? []).some(
            (entry) =>
              entry.type === "RECURRING" &&
              entry.dayOfWeek === block.dayOfWeek &&
              entry.startMinute === block.startMinute &&
              entry.endMinute === block.endMinute &&
              (entry.endDate ? toYmd(new Date(entry.endDate)) : null) ===
                (block.endDate ?? null)
          )
      );
      if (fresh.length === 0) {
        setBlockError(
          blocks.length === 1
            ? "That block already exists."
            : "Those blocks already exist."
        );
        return;
      }
      setBusyAction("block");
      try {
        await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "RECURRING", blocks: fresh }),
        });
        await reload();
        window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
      } finally {
        setBusyAction(null);
      }
      return;
    }

    // Specific: a standalone (request-independent) day or range, blocked for
    // the chosen time windows — one block per window, with touching windows
    // merged the same way the recurring branch does ("morning + afternoon" is
    // one 6am–5pm block, not two). Leave endDate off for a single day.
    if (!blockStart) return;
    const specWindows = mergeWindows(
      presetIndexes.map((i) => {
        const preset = TIME_PRESETS[i];
        return preset.start === -1
          ? {
              startMinute: timeStringToMinutes(customStart),
              endMinute: timeStringToMinutes(customEnd),
            }
          : { startMinute: preset.start, endMinute: preset.end };
      })
    );
    if (specWindows.length === 0) {
      setBlockError("Pick at least one time window.");
      return;
    }
    if (specWindows.some((w) => w.startMinute >= w.endMinute)) {
      setBlockError("The custom end time must be after the start time.");
      return;
    }
    setBusyAction("block");
    try {
      for (const w of specWindows) {
        await fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "SPECIFIC",
            date: blockStart,
            endDate: blockEnd && blockEnd !== blockStart ? blockEnd : undefined,
            startMinute: w.startMinute,
            endMinute: w.endMinute,
          }),
        });
      }
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
  async function editDays(startYmd: string, endYmd: string, blocked: boolean) {
    const previous = entries;
    setEntries((cur) =>
      cur ? applyDayEdit(cur, startYmd, endYmd, blocked) : cur
    );
    setClearNote(null);
    try {
      const res = await fetch("/api/availability/block-days", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ start: startYmd, end: endYmd, blocked }),
      });
      if (!res.ok) throw new Error("block-days failed");
      // Clearing days can't punch a hole in a weekly rule, so those days stay
      // blocked. Say why, rather than letting the gesture look broken.
      const data = await res.json().catch(() => ({}));
      if (!blocked && data.recurringDays > 0) {
        setClearNote(
          `${data.recurringDays} of those ${
            data.recurringDays === 1 ? "days is" : "days are"
          } still blocked by a weekly repeat — remove it below to free them.`
        );
      }
      await reload();
      window.dispatchEvent(new Event(AVAILABILITY_CHANGED_EVENT));
    } catch {
      setEntries(previous); // roll back the optimistic change
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
          {/* Blocks that stop repeating say when; open-ended ones say nothing. */}
          {entry.endDate && <> · until {shortDateLabel(entry.endDate)}</>}
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
    // Legacy DATE_RANGE: show both endpoints for a real range, but just the one
    // date when it's a single day (start === end, or no endDate).
    const rangeStart = new Date(entry.startDate!);
    const rangeEnd = entry.endDate ? new Date(entry.endDate) : null;
    const singleDay =
      !rangeEnd || rangeEnd.toDateString() === rangeStart.toDateString();
    return (
      <>
        <strong>{rangeStart.toLocaleDateString()}</strong>
        {!singleDay && (
          <>
            {" to "}
            <strong>{rangeEnd!.toLocaleDateString()}</strong>
          </>
        )}
        {entry.note && <span className="text-gray-500"> — {entry.note}</span>}
      </>
    );
  }

  // Full-page loader only for the initial load — never for mutations.
  usePageLoading(!entries);
  if (!entries) return null;

  const selectedRequest = requests.find((r) => r.id === selectedRequestId);
  // Answered = there's a response row with a completedAt for it.
  const isAnswered = (requestId: string) =>
    responses.some((x) => x.requestId === requestId && x.completedAt);
  const todoRequests = requests.filter((r) => !isAnswered(r.id));
  // Under "Todo" the selected card stays on screen even once it's answered —
  // otherwise submitting would yank the card (and its "Make changes" button)
  // out from under you the instant you clicked Submit.
  const visibleRequests =
    requestFilter === "all"
      ? requests
      : requests.filter((r) => !isAnswered(r.id) || r.id === selectedRequestId);
  // The selected request's window, as the day pickers want it: rings its days
  // (and dims the rest, on the calendar). Null = showing everything.
  const lensRange = selectedRequest
    ? {
        start: toYmd(new Date(selectedRequest.startDate)),
        end: toYmd(new Date(selectedRequest.endDate)),
      }
    : null;

  // The days I'll be marked unavailable for the selected request — shown in the
  // submit-confirmation modal.
  const confirmDays = selectedRequest
    ? blockedDaysInRange(entries, selectedRequest.startDate, selectedRequest.endDate)
    : [];

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
      {/* ── 1. What you've been asked for ─────────────────────────────────
          The job that brings people here is "do I owe anyone an answer?", so
          it's the first thing on the page — one card per request, across every
          org, with its state on the face of it. Picking one doesn't navigate
          anywhere: it LENSES the calendar below onto that request's window, so
          the ask and the schedule that answers it are never separated. */}
      <section data-tour="avail-editors" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-bold">Requests</h2>
            <InfoTooltip
              side="bottom"
              text="Pick a request to see its dates on the calendar below, block the days you can't serve, then submit. Times you've already blocked count automatically."
            />
          </div>
          {/* Todo / All, with counts so the filter says what it's hiding. */}
          {requests.length > 0 && (
            <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
              {(
                [
                  { key: "todo", label: "Todo", count: todoRequests.length },
                  { key: "all", label: "All", count: requests.length },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  aria-pressed={requestFilter === tab.key}
                  onClick={() => setRequestFilter(tab.key)}
                  className={requestTabClass(requestFilter === tab.key)}
                >
                  {tab.label}
                  <span
                    className={`rounded-full px-1.5 text-xs ${
                      requestFilter === tab.key
                        ? "bg-white/20"
                        : "bg-gray-200 dark:bg-gray-700"
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {requests.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500">
              No one has asked for your availability yet. You can still block
              out any dates below.
            </p>
          </Card>
        ) : visibleRequests.length === 0 ? (
          <Card>
            <p className="text-sm text-gray-500">
              You&apos;re all caught up — every request has been answered.{" "}
              <button
                type="button"
                onClick={() => setRequestFilter("all")}
                className="rounded text-indigo-600 underline underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200"
              >
                Show all requests
              </button>
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {visibleRequests.map((r) => {
              const response = responses.find((x) => x.requestId === r.id);
              const done = !!response?.completedAt;
              const active = r.id === selectedRequestId;
              return (
                <Card
                  key={r.id}
                  // The whole card is the target — clicking anywhere lenses the
                  // calendar. Selected gets a left rail + ring so you can tell
                  // at a glance which window the calendar is showing.
                  className={`cursor-pointer border-l-4 transition-colors ${
                    active
                      ? // The one driving the calendar: accent ground + ring, so
                        // it reads as selected at a glance rather than by a
                        // hairline that disappears against a dark card.
                        "border-l-indigo-500 bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-500/10"
                      : done
                        ? "border-l-green-500/60 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                        : "border-l-amber-400 hover:bg-gray-50 dark:hover:bg-gray-700/40"
                  }`}
                  // Clicking the active card again drops the filter, so the
                  // calendar goes back to showing everything.
                  onClick={() =>
                    setSelectedRequestId((cur) => (cur === r.id ? "" : r.id))
                  }
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{requestLabel(r)}</span>
                        {/* Which org is asking — requests span them all. */}
                        {r.org && (
                          <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                            {r.org.name}
                          </span>
                        )}
                        {done ? (
                          <Badge tone="green">
                            {response!.edited ? "Updated" : "Sent"}
                          </Badge>
                        ) : (
                          <Badge tone="amber">Not sent</Badge>
                        )}
                      </div>
                      {/* The description line. On the SELECTED card it also
                          carries what the calendar is doing, the way out, and a
                          running count of what submitting would send — all on
                          this line rather than as a row of its own, which grew
                          the card on click and shoved the rest of the page
                          down every time you picked a request. */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                        <span>
                          {shortDateLabel(r.startDate)} –{" "}
                          {shortDateLabel(r.endDate)}
                          {done && response!.completedAt && (
                            <>
                              {" · sent "}
                              {new Date(response!.completedAt).toLocaleDateString()}
                            </>
                          )}
                        </span>
                        {active && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="inline-flex items-center gap-1.5 font-medium text-indigo-700 dark:text-indigo-300">
                              <EyeIcon />
                              Shown on the calendar below
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedRequestId("");
                              }}
                              className="rounded text-indigo-600 underline underline-offset-2 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-200"
                            >
                              Show all dates
                            </button>
                            {!done && (
                              <span>
                                ·{" "}
                                {confirmDays.length === 0
                                  ? "You're available every day in this window."
                                  : `Unavailable on ${confirmDays.length} ${
                                      confirmDays.length === 1 ? "day" : "days"
                                    }.`}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* The action lives on the selected card only, so there's
                        exactly one submit button on screen at a time. */}
                    {active &&
                      (done ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleComplete();
                          }}
                          disabled={busyAction === "complete"}
                        >
                          {busyAction === "complete" ? (
                            <LoadingDots size="sm" />
                          ) : (
                            "Make changes"
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmOpen(true);
                          }}
                          disabled={busyAction === "complete"}
                        >
                          {busyAction === "complete" ? (
                            <LoadingDots size="sm" />
                          ) : (
                            "Submit response"
                          )}
                        </Button>
                      ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 2. My availability ────────────────────────────────────────────
          The standing picture: one calendar (lensed to the selected request),
          the list of blocks, and the form that creates them. Every request
          above is answered out of THIS data — which is why it's one calendar
          on one page rather than a second copy behind a tab. */}
      <section className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xl font-bold">My availability</h2>
          <InfoTooltip text="Blocks here apply to every org and every request. Click or drag the calendar to block whole days; use the form for a repeating block or a specific time window." />
        </div>

        <div className="flex flex-col gap-6">
          <div className="min-w-0 space-y-3">
            {/* What the calendar is currently showing, stated at the calendar
                rather than only up on the card — the filter and its effect are
                far enough apart on screen to need saying in both places. */}
            <div className="hidden items-center gap-2 lg:flex">
              {selectedRequest ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1 text-sm font-medium text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200">
                    <EyeIcon />
                    Filtered to {requestLabel(selectedRequest)}
                    <button
                      type="button"
                      onClick={() => setSelectedRequestId("")}
                      aria-label="Show all dates"
                      title="Show all dates"
                      className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-indigo-600 transition-colors hover:bg-indigo-200 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-indigo-500/40 dark:hover:text-white"
                    >
                      <svg
                        viewBox="0 0 14 14"
                        className="h-2.5 w-2.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" />
                      </svg>
                    </button>
                  </span>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Days outside it are dimmed.
                  </span>
                </>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  Showing all your dates.
                  {requests.length > 0 && " Pick a request above to focus on its window."}
                </span>
              )}
            </div>

            {/* Calendar and the list of what's behind it, side by side on
                desktop: the grid answers "which days", the list names the
                blocks producing them and is where you delete one. On a phone
                the grid gives way to WeekStrip — a week at a time, so each day
                is still a thumb-sized target. */}
            {/* Calendar and the editor beside it, stretched to the same
                height so the panel never trails empty space next to a
                six-week month. The list of blocks runs full width underneath,
                where it can breathe. */}
            <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
            {/* Phone: a week of tappable days, standing above the form the way
                the calendar stands beside it. */}
            <div className="lg:hidden">
              <WeekStrip
                entries={entries}
                onEditDays={editDays}
                busy={busyAction === "specific"}
                highlightRange={lensRange}
              />
            </div>
            <div
              data-tour="avail-calendar"
              className="hidden min-w-0 lg:block lg:flex-[2]"
            >
              <AvailabilityCalendar
                entries={entries}
                onEditDays={editDays}
                busy={busyAction === "specific"}
                // Selecting a request above rings its days and dims the rest,
                // and pulls the view to the month it starts in.
                highlightRange={lensRange}
              />
            </div>
          <div className="flex min-w-0 flex-col lg:flex-1">
          {/* Block out times — a one-off specific date/range OR a weekly
              recurring block, in one form. This is the ONLY place blocks are
              created; a request above is answered by clicking the calendar. */}
          <section className="flex min-w-0 flex-1 flex-col">
            {/* Built like the calendar beside it — titled header, a rule, then
                the body — rather than a floating heading over a card. */}
            <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div className="flex items-center gap-1.5 px-4 pb-2 pt-3">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Block out times
                </h2>
                <InfoTooltip text="Block times you can't serve — specific dates and times, or a weekly repeat." />
              </div>

              {/* Recurring vs. specific. */}
              <div className="flex gap-1 border-b border-gray-200 px-4 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => setBlockKind("recurring")}
                  aria-pressed={blockKind === "recurring"}
                  className={blockKindClass(blockKind === "recurring")}
                >
                  Every week
                </button>
                <button
                  type="button"
                  onClick={() => setBlockKind("specific")}
                  aria-pressed={blockKind === "specific"}
                  className={blockKindClass(blockKind === "specific")}
                >
                  Specific times
                </button>
              </div>

              {/* A column, so each form can pin its submit to the foot of the
                  panel rather than leaving it stranded mid-card. */}
              <div className="flex flex-1 flex-col p-4">
              {blockKind === "recurring" ? (
                // Weekly recurring: any weekdays × any time windows, stored as
                // one block per weekday per (merged) window.
                <form onSubmit={addBlock} className="flex flex-1 flex-col gap-4">
                  {/* Weekdays — multi-select, so "Mon–Fri" is five taps
                      instead of five separate blocks. */}
                  <fieldset>
                    <legend className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Days of week
                    </legend>
                    <div className="flex overflow-hidden rounded-lg border border-gray-300 dark:border-gray-600">
                      {DAY_LABELS.map((label, i) => (
                        <button
                          key={label}
                          type="button"
                          aria-label={label}
                          aria-pressed={daysOfWeek.includes(i)}
                          onClick={() => setDaysOfWeek(toggled(daysOfWeek, i))}
                          className={dayCellClass(daysOfWeek.includes(i))}
                        >
                          {/* One letter on a phone, where seven three-letter
                              cells don't fit; "Tue" from sm up. */}
                          <span className="sm:hidden">{label.slice(0, 1)}</span>
                          <span className="hidden sm:inline">{label.slice(0, 3)}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>
                  <TimeWindowPicker
                    selected={presetIndexes}
                    onToggle={toggleWindow}
                    customStart={customStart}
                    customEnd={customEnd}
                    onCustomStart={setCustomStart}
                    onCustomEnd={setCustomEnd}
                  />
                  {/* How long it repeats — one choice out of three, so a real
                      dropdown; whatever it needs next appears under it. */}
                  <div className="space-y-2">
                    <Select
                      label="Repeats"
                      value={repeats}
                      onChange={(e) =>
                        setRepeats(e.target.value as typeof repeats)
                      }
                    >
                      {REPEAT_OPTIONS.map(({ value, label }) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                    {repeats === "weeks" && (
                      <span className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                        <Input
                          label="Number of weeks"
                          hideLabel
                          type="number"
                          min={1}
                          max={52}
                          value={repeatWeeks}
                          onChange={(e) => setRepeatWeeks(e.target.value)}
                          className="w-20 py-1.5"
                        />
                        weeks
                      </span>
                    )}
                    {repeats === "until" && (
                      <DateSelect
                        label="Last day it repeats"
                        value={repeatUntil}
                        min={toYmd(new Date())}
                        onChange={setRepeatUntil}
                        required
                      />
                    )}
                  </div>
                  {/* mt-auto drops the submit to the bottom of the panel
                      however tall the fields above it end up. */}
                  <div className="mt-auto space-y-2 pt-3">
                    {blockError && (
                      <p className="text-sm text-rose-600 dark:text-rose-400">
                        {blockError}
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={
                        busyAction === "block" ||
                        daysOfWeek.length === 0 ||
                        presetIndexes.length === 0
                      }
                    >
                      {busyAction === "block" ? (
                        <LoadingDots size="sm" />
                      ) : (
                        "Add recurring block"
                      )}
                    </Button>
                  </div>
                </form>
              ) : (
                // Specific: a day or range, blocked for the chosen windows —
                // the same time picker the recurring side uses, so "block
                // Thursday afternoon" doesn't mean losing the whole day.
                <form onSubmit={addBlock} className="flex flex-1 flex-col gap-4">
                  <DateSelect
                    range
                    highlightToday={false}
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
                  <TimeWindowPicker
                    selected={presetIndexes}
                    onToggle={toggleWindow}
                    customStart={customStart}
                    customEnd={customEnd}
                    onCustomStart={setCustomStart}
                    onCustomEnd={setCustomEnd}
                  />
                  <div className="mt-auto space-y-2 pt-3">
                    {blockError && (
                      <p className="text-sm text-rose-600 dark:text-rose-400">
                        {blockError}
                      </p>
                    )}
                    <Button
                      type="submit"
                      disabled={
                        !blockStart ||
                        busyAction === "block" ||
                        presetIndexes.length === 0
                      }
                    >
                      {busyAction === "block" ? (
                        <LoadingDots size="sm" />
                      ) : (
                        "Block these times"
                      )}
                    </Button>
                  </div>
                </form>
              )}
              </div>
            </div>
          </section>
          </div>
            </div>
            {clearNote && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                {clearNote}
              </p>
            )}
          </div>


          {/* Every block behind the calendar, full width — one row apiece with
              its kind, its window and a Delete. */}
          <div className="min-w-0">
          <Card className="max-h-[26rem] overflow-y-auto">
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
                        <Badge tone={entry.type === "RECURRING" ? "gray" : "blue"}>
                          {entry.type === "RECURRING" ? "Recurring" : "Specific"}
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
                        // An optimistic (not-yet-saved) block has no real DB row
                        // to delete — disable until the reload swaps in its real
                        // id (a fraction of a second), so a fast click can't fire
                        // a no-op delete that leaves the block stranded.
                        disabled={
                          busyEntryId === entry.id || isOptimisticId(entry.id)
                        }
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
      </section>
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

// "This is what you're looking at" — marks the request the calendar is
// currently filtered to, on the card and on the calendar's own status line.
function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
