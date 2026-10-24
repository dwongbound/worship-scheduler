"use client";
// "Import from Google Calendar" on /schedule, as a modal.
//
// It used to be one click that navigated away, read every calendar and came
// back with the blocks already written. Now it is a screen: pick WHICH of your
// calendars to read, see what they would block in the same week grid the page
// itself draws, and only then import. The consent trip is the one thing that
// still leaves the page — a Google consent screen can't live in a fetch — and
// it returns to /schedule?gcalImport=connected, which reopens this modal, so
// signing in lands on the picker instead of looking like the app restarting.
//
// Every Google call puts a BLOCKING overlay over the body with what it's
// doing, because each one is a round trip to Google and a quiet pause reads as
// a broken screen.
//
// The preview shows what Google would add and nothing else: no weekly repeats,
// no blocks made by hand. One question per screen. And it shows the windows
// the IMPORT itself computed (GET …/import/preview runs the import's own
// code), merged per day — so overlapping events from however many calendars
// are one block, and the preview can't disagree with what lands.
import { useCallback, useEffect, useState } from "react";
import AvailabilityWeekView from "./AvailabilityWeekView";
import Button from "./common/Button";
import Checkbox from "./common/Checkbox";
import LoadingDots from "./common/LoadingDots";
import Modal from "./common/Modal";
import type { ImportCalendar } from "@/lib/googleAvailability";
import { busyWindowEntries, type BusyWindow } from "@/lib/googleBusy";

// Where the person is in the flow. "picking" and "previewing" are the two
// screens; the rest is what's between them.
type Phase = "loading" | "picking" | "previewing";

export default function GoogleImportModal({
  open,
  onClose,
  requestId,
  window: requestWindow,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  requestId: string;
  // The request's window (YYYY-MM-DD, inclusive): the preview opens on the
  // week it starts in and dims the days outside it.
  window: { start: string; end: string };
  // How many blocks were written. The page says so and reloads.
  onImported: (blocks: number) => void;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [calendars, setCalendars] = useState<ImportCalendar[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [windows, setWindows] = useState<BusyWindow[]>([]);
  // What Google is being asked for right now — the overlay's words. Null = the
  // screen is the person's to use.
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The consent screen can't be a fetch, so this is a real navigation. It
  // comes back to /schedule, which reopens this modal.
  const toConsent = useCallback(() => {
    setBusy("Sending you to Google…");
    window.location.href = `/api/google-calendar/import?requestId=${encodeURIComponent(requestId)}`;
  }, [requestId]);

  // Opening asks for the calendar list, which is the first Google call.
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPhase("loading");
    setError(null);
    setWindows([]);
    setBusy("Loading your calendars…");
    (async () => {
      try {
        const res = await fetch(
          `/api/google-calendar/import/calendars?requestId=${encodeURIComponent(requestId)}`
        );
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (data.needsConsent) {
          toConsent();
          return;
        }
        if (!res.ok) {
          setError(data.error ?? "Couldn't read your calendars.");
          setBusy(null);
          setPhase("picking");
          return;
        }
        const list: ImportCalendar[] = data.calendars ?? [];
        setCalendars(list);
        // All of them to begin with: the common case is "everything I keep my
        // life in", and un-ticking is easier than hunting for the right one.
        setPicked(new Set(list.map((c) => c.id)));
        setBusy(null);
        setPhase("picking");
      } catch {
        if (!live) return;
        setError("Couldn't read your calendars.");
        setBusy(null);
        setPhase("picking");
      }
    })();
    return () => {
      live = false;
    };
  }, [open, requestId, toConsent]);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const preview = async () => {
    setError(null);
    const ids = [...picked];
    setBusy(
      ids.length === 1 ? "Reading your calendar…" : `Reading ${ids.length} calendars…`
    );
    try {
      const params = new URLSearchParams({ requestId, calendarIds: ids.join(",") });
      const res = await fetch(`/api/google-calendar/import/preview?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (data.needsConsent) {
        toConsent();
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't read your calendars.");
        setBusy(null);
        return;
      }
      setWindows(data.windows ?? []);
      setBusy(null);
      setPhase("previewing");
    } catch {
      setError("Couldn't read your calendars.");
      setBusy(null);
    }
  };

  const doImport = async () => {
    setError(null);
    setBusy("Importing…");
    try {
      const res = await fetch("/api/google-calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, calendarIds: [...picked] }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.needsConsent) {
        toConsent();
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Couldn't import from Google Calendar.");
        setBusy(null);
        return;
      }
      setBusy(null);
      onImported(data.blocks ?? 0);
    } catch {
      setError("Couldn't import from Google Calendar.");
      setBusy(null);
    }
  };

  const count = windows.length;
  const footer =
    phase === "previewing" ? (
      <>
        <span className="hidden text-sm text-gray-500 sm:inline dark:text-gray-400">
          Nothing is saved until you import.
        </span>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button
            variant="secondary"
            className="flex-1 sm:flex-none"
            disabled={!!busy}
            onClick={() => setPhase("picking")}
          >
            Back
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            loading={busy === "Importing…"}
            disabled={!!busy}
            onClick={doImport}
          >
            {count === 0
              ? "Import"
              : `Import ${count} ${count === 1 ? "block" : "blocks"}`}
          </Button>
        </div>
      </>
    ) : (
      <>
        <span className="hidden text-sm text-gray-500 sm:inline dark:text-gray-400">
          {picked.size} of {calendars.length}{" "}
          {calendars.length === 1 ? "calendar" : "calendars"} selected
        </span>
        <div className="flex w-full gap-2 sm:w-auto">
          <Button variant="secondary" className="flex-1 sm:flex-none" onClick={onClose}>
            Close
          </Button>
          <Button
            className="flex-1 sm:flex-none"
            disabled={!!busy || picked.size === 0}
            onClick={preview}
          >
            Preview
          </Button>
        </div>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import from Google Calendar"
      subtitle={
        phase === "previewing"
          ? "What this would block"
          : "Which calendars should it read?"
      }
      size="xl"
      footer={footer}
    >
      <div className="relative">
        {/* The blocking indicator. Over the body, not beside it: while Google
            is being read there is nothing on this screen to use, and the
            footer's buttons are disabled to match. */}
        {busy && (
          <div
            data-testid="import-busy"
            className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm dark:bg-gray-800/80"
          >
            <LoadingDots size="lg" className="text-indigo-600 dark:text-indigo-300" />
            <p className="text-sm text-gray-600 dark:text-gray-300">{busy}</p>
          </div>
        )}

        {error && (
          <p
            data-testid="import-error"
            className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {phase === "previewing" ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {count === 0
                ? "Nothing on the calendars you picked in this window, so importing would leave you free throughout."
                : `${count} ${count === 1 ? "block" : "blocks"} from ${picked.size} ${
                    picked.size === 1 ? "calendar" : "calendars"
                  }. Overlapping events are combined, so each busy stretch is one block.`}
            </p>
            {/* Only the import's own blocks: what's already on the calendar
                isn't the question on this screen. */}
            <AvailabilityWeekView
              entries={busyWindowEntries(windows)}
              highlightRange={requestWindow}
              googleImport
              legendKinds={["google"]}
            />
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Every event on the calendars you tick becomes a blocked time, and
              an all-day event blocks the whole day. Calendars you only
              subscribe to, like holidays, are left out.
            </p>
            {calendars.length === 0 && !busy && !error && (
              <p className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                No calendars of your own on this Google account.
              </p>
            )}
            {calendars.map((c) => (
              <Checkbox
                key={c.id}
                rowTarget
                checked={picked.has(c.id)}
                onChange={() => toggle(c.id)}
                label={
                  <span className="flex items-center gap-2">
                    <span>{c.name}</span>
                    {c.primary && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        main
                      </span>
                    )}
                  </span>
                }
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
