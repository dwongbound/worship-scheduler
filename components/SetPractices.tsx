"use client";
// A set's practices, in the set detail modal under the Songs section.
//
// A practice is an extra calendar event for the people already on this set —
// deliberately absent from the app calendar, so THIS is the only place one is
// ever seen. Everyone on the set can read them and check who's free; adding
// and deleting is admin-only.
//
// Unlike the rest of the modal, add and delete act IMMEDIATELY rather than
// staging until Save: each one sends or cancels a real calendar invite for the
// whole roster, which is the same reason deleting the set and sending a note
// act immediately too.
import { useState } from "react";
import Button from "./common/Button";
import Input from "./common/Input";
import Modal from "./common/Modal";
import Badge from "./common/Badge";
import LoadingDots from "./common/LoadingDots";
import DateSelect from "./common/DateSelect";
import { MAX_PRACTICES_PER_SET, validateSetPractice } from "@/lib/practices";
import {
  formatDay,
  formatTime,
  minutesToTimeInput,
  timeStringToMinutes,
  toYmd,
} from "@/lib/dates";
import type { ApiSetPractice } from "@/lib/types";

/** One person's answer in the free/busy modal. */
interface FreeBusyPerson {
  userId: string;
  name: string;
  roles: string[];
  free: boolean;
  blockedBy: {
    type: string;
    dayOfWeek: number | null;
    startMinute: number | null;
    endMinute: number | null;
    fromGoogle: boolean;
  }[];
}

/** "Wed, Nov 4 · 7:00 – 9:00 PM" — one line, both ends, no duration. */
function practiceWhen(practice: ApiSetPractice): string {
  const start = new Date(practice.startsAt);
  const end = new Date(practice.endsAt);
  return `${formatDay(start)} · ${formatTime(start)} – ${formatTime(end)}`;
}

/** Why someone isn't free, in a few words. */
function blockReason(person: FreeBusyPerson): string {
  if (person.blockedBy.length === 0) return "Busy";
  const block = person.blockedBy[0];
  if (block.type === "RECURRING") return "Weekly block";
  if (block.fromGoogle) return "Busy in Google Calendar";
  return "Blocked that day";
}

export default function SetPractices({
  setId,
  practices,
  isAdmin,
  onChanged,
}: {
  setId: string;
  practices: ApiSetPractice[];
  isAdmin: boolean;
  /** Refetch the set — practices are saved immediately, not staged. */
  onChanged: () => void | Promise<void>;
}) {
  // Which practice's free/busy modal is open, and its lazily-read answer.
  const [open, setOpen] = useState<ApiSetPractice | null>(null);
  const [people, setPeople] = useState<FreeBusyPerson[] | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // The add form, and the delete confirm (it emails everyone a cancellation,
  // so it asks first).
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(() => toYmd(new Date()));
  const [startMinute, setStartMinute] = useState(19 * 60);
  const [endMinute, setEndMinute] = useState(21 * 60);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ApiSetPractice | null>(null);

  // Nothing is read until a practice is actually clicked — a set can carry
  // several, and almost none of them are ever looked at.
  async function openFreeBusy(practice: ApiSetPractice) {
    setOpen(practice);
    setPeople(null);
    setReadError(null);
    try {
      const res = await fetch(
        `/api/sets/${setId}/practices/${practice.id}/availability`
      );
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { people: FreeBusyPerson[] };
      setPeople(json.people);
    } catch {
      setReadError("Couldn't check who's free. Close this and try again.");
    }
  }

  function localDate(ymd: string, minute: number): Date {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60);
  }

  async function add() {
    const startsAt = localDate(date, startMinute);
    const endsAt = localDate(date, endMinute);
    // The same validator the route runs, so the form can't offer a save that
    // would come back a 400.
    const check = validateSetPractice(
      { startsAt, endsAt },
      practices.map((p) => new Date(p.startsAt))
    );
    if ("error" in check) {
      setAddError(check.error);
      return;
    }
    setBusy(true);
    setAddError(null);
    try {
      const res = await fetch(`/api/sets/${setId}/practices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setAddError(json?.error ?? "Couldn't add that practice.");
        return;
      }
      setAdding(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(practice: ApiSetPractice) {
    setBusy(true);
    try {
      await fetch(`/api/sets/${setId}/practices/${practice.id}`, {
        method: "DELETE",
      });
      setConfirmDelete(null);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-gray-200 pt-4 dark:border-gray-700">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Practices
      </p>

      {practices.length === 0 ? (
        <p className="text-sm text-gray-400">No practices yet.</p>
      ) : (
        <div className="space-y-2">
          {practices.map((practice) => (
            <div key={practice.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openFreeBusy(practice)}
                className="flex flex-1 items-center justify-between gap-3 rounded-lg border border-gray-200
                  bg-gray-50 px-3 py-2 text-left text-sm hover:border-indigo-300 hover:bg-indigo-50
                  dark:border-gray-700 dark:bg-gray-800/60 dark:hover:border-indigo-700
                  dark:hover:bg-indigo-950/30"
              >
                <span className="font-medium">{practiceWhen(practice)}</span>
                {/* Not a count — nothing has been read yet. The point of the
                    row is that clicking it is what asks. */}
                <Badge size="sm" tone="gray">
                  Who&rsquo;s free?
                </Badge>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  aria-label="Delete practice"
                  onClick={() => setConfirmDelete(practice)}
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-lg text-gray-400
                    hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                >
                  <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden>
                    <path
                      d="M4 4l10 10M14 4L4 14"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {isAdmin && !adding && (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          disabled={practices.length >= MAX_PRACTICES_PER_SET}
          onClick={() => {
            setAdding(true);
            setAddError(null);
          }}
        >
          + Add practice
        </Button>
      )}

      {isAdmin && adding && (
        <div className="mt-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <DateSelect label="Date" value={date} onChange={setDate} />
            </div>
            <div className="w-28">
              <Input
                label="From"
                // Test id rather than the label: getByLabel is a substring,
                // case-insensitive match, and "From" also appears inside the
                // roster's "Measure recent load" option text one modal up.
                data-testid="practice-from"
                type="time"
                value={minutesToTimeInput(startMinute)}
                onChange={(e) => setStartMinute(timeStringToMinutes(e.target.value))}
              />
            </div>
            <div className="w-28">
              <Input
                label="To"
                data-testid="practice-to"
                type="time"
                value={minutesToTimeInput(endMinute)}
                onChange={(e) => setEndMinute(timeStringToMinutes(e.target.value))}
              />
            </div>
          </div>
          {addError && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{addError}</p>
          )}
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Everyone on this set gets a calendar invite as soon as you add it.
          </p>
          <div className="mt-2 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Close
            </Button>
            <Button size="sm" onClick={add} loading={busy}>
              Add practice
            </Button>
          </div>
        </div>
      )}

      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
        Practices aren&rsquo;t on the calendar — they live here, and as a calendar
        invite for everyone on the set.
      </p>

      {/* Who's free, read when the practice was clicked. */}
      {open && (
        <Modal open onClose={() => setOpen(null)} title={practiceWhen(open)}>
          {readError ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">{readError}</p>
          ) : people === null ? (
            <div className="flex items-center gap-3 py-8 text-sm text-gray-500 dark:text-gray-400">
              <LoadingDots size="sm" />
              Checking who&rsquo;s free…
            </div>
          ) : people.length === 0 ? (
            <p className="text-sm text-gray-400">
              Nobody is on this set yet, so there&rsquo;s nobody to check.
            </p>
          ) : (
            <>
              <div className="divide-y divide-gray-200 dark:divide-gray-700">
                {/* Busiest first: the people who can't make it are the reason
                    anyone opened this. */}
                {[...people]
                  .sort((a, b) => Number(a.free) - Number(b.free))
                  .map((person) => (
                    <div key={person.userId} className="flex items-center gap-2 py-2">
                      <span className="flex-1 text-sm">{person.name}</span>
                      {person.free ? (
                        <Badge size="sm" tone="green">
                          Free
                        </Badge>
                      ) : (
                        <Badge size="sm" tone="amber">
                          {blockReason(person)}
                        </Badge>
                      )}
                    </div>
                  ))}
              </div>
              <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                {people.filter((p) => p.free).length} of {people.length} free. This
                is the same availability the scheduler reads — but a practice is
                never a booking, so auto schedule ignores it.
              </p>
            </>
          )}
        </Modal>
      )}

      {/* Deleting cancels the event, which emails everyone — so it asks. */}
      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Delete this practice?"
        >
          <p className="text-sm text-gray-700 dark:text-gray-300">
            {practiceWhen(confirmDelete)}. Everyone on the set gets a cancellation
            from Google Calendar.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(null)}
              disabled={busy}
            >
              Close
            </Button>
            <Button
              variant="danger"
              data-destructive
              onClick={() => remove(confirmDelete)}
              loading={busy}
            >
              Delete practice
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
