"use client";

// Org settings → Google Calendar (admins only; the page doesn't render it for
// members). The shared Google account whose calendar holds an event per set,
// roster invited; accepting an invite confirms that seat (lib/googleCalendar.ts).
//
// WHICH calendar is the connecting admin's call alone. The account may be their
// own, so its calendar list is fetched only for them — /calendars refuses
// everyone else — and the other admins read just the chosen calendar's name and
// who connected it. Hidden entirely on a deployment without the Google OAuth
// client (`configured` false), since Connect couldn't work there.
import { useCallback, useEffect, useState } from "react";
import Button from "@/components/common/Button";
import InfoTooltip from "@/components/common/InfoTooltip";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";

// What GET /api/google-calendar/status says about one org (admins only).
type GcalStatus = {
  configured: boolean;
  connected: boolean;
  email: string | null;
  calendarName: string | null;
  connectedByName: string | null;
  connectedByMe: boolean;
};

type Choice = { id: string; name: string; primary: boolean };

export default function OrgGoogleCalendar({
  orgId,
  onChanged,
}: {
  orgId: string;
  // Re-pull /api/me after a disconnect, so the rest of the app sees it.
  onChanged: () => unknown;
}) {
  const [status, setStatus] = useState<GcalStatus | null>(null);
  // The picker — loaded only for the admin who connected.
  const [choices, setChoices] = useState<Choice[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState("");
  const [needsReconnect, setNeedsReconnect] = useState(false);
  // A pick waiting on "move every set?" — moving re-sends every invite.
  const [pending, setPending] = useState<Choice | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/google-calendar/status?orgId=${orgId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: GcalStatus | null) => setStatus(data))
      .catch(() => {});
  }, [orgId]);
  useEffect(() => {
    setStatus(null);
    setChoices(null);
    setPickerError("");
    setNeedsReconnect(false);
    load();
  }, [load]);

  const mine = !!status?.connected && status.connectedByMe;
  useEffect(() => {
    if (!mine) return;
    let cancelled = false;
    fetch(`/api/google-calendar/calendars?orgId=${orgId}`)
      .then(async (r) => {
        const data = await r.json().catch(() => null);
        if (cancelled) return;
        if (!r.ok) {
          setNeedsReconnect(!!data?.reconnect);
          setPickerError(data?.error ?? "Couldn't load your calendars.");
          return;
        }
        setChoices(data.calendars);
        setSelectedId(data.selectedId);
      })
      .catch(() => !cancelled && setPickerError("Couldn't load your calendars."));
    return () => {
      cancelled = true;
    };
  }, [mine, orgId]);

  async function move(choice: Choice) {
    setMoving(true);
    setPickerError("");
    try {
      const res = await fetch(`/api/google-calendar/calendars?orgId=${orgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: choice.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setPickerError(data?.error ?? "Couldn't switch calendars.");
        return;
      }
      setSelectedId(choice.id);
      setPending(null);
      load();
    } finally {
      setMoving(false);
    }
  }

  if (!status?.configured) return null;

  // The chosen calendar may not be in the list (it's the app-made one and the
  // list hasn't loaded yet); the select still shows it by name.
  const options =
    choices && selectedId && !choices.some((c) => c.id === selectedId)
      ? [{ id: selectedId, name: status.calendarName ?? "Current calendar", primary: false }, ...choices]
      : choices ?? [];

  return (
    <div className="mt-6 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">Google Calendar</p>
        <InfoTooltip text="One Google account holds a calendar of every set. Each set's event invites its roster by email, with the same roles and setlist the Slack messages carry, and follows every change: roster edits, approved swaps and covers, setlist updates, a deleted set. Accepting the invite confirms you for that set here; declining changes nothing. Only the admin who connected the account can choose which of its calendars is used." />
      </div>
      <p className="text-sm text-gray-500">
        {status.connected
          ? status.email
            ? `Connected as ${status.email} ✓`
            : "Connected ✓"
          : "Not connected. Sets aren't on a calendar and nobody gets invites yet."}
      </p>

      {status.connected && (
        <div className="space-y-1 text-sm">
          {mine && options.length > 0 ? (
            <div className="max-w-[20rem]">
              <Select
                label="Calendar for sets"
                value={selectedId ?? ""}
                disabled={moving}
                onChange={(e) => {
                  const choice = options.find((c) => c.id === e.target.value);
                  if (choice && choice.id !== selectedId) setPending(choice);
                }}
              >
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.primary ? " (main)" : ""}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-400">
                Only you can see this list. Other admins see the calendar&rsquo;s name.
              </p>
            </div>
          ) : (
            <p className="text-gray-500">
              Calendar: {status.calendarName ?? "the TapWorship calendar"}
              {!mine && status.connectedByName && (
                <>
                  {" "}
                  · connected by {status.connectedByName}, who is the only one who can change it
                </>
              )}
            </p>
          )}
          {pickerError && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {pickerError}
              {needsReconnect && " Reconnecting asks Google for permission to list your calendars."}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button
          onClick={() => {
            window.location.href = `/api/google-calendar/connect?orgId=${orgId}`;
          }}
        >
          {status.connected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
        </Button>
        {status.connected && (
          <Button
            variant="dangerOutline"
            className="ml-auto"
            onClick={async () => {
              await fetch(`/api/google-calendar/connect?orgId=${orgId}`, {
                method: "DELETE",
              });
              load();
              await onChanged();
            }}
          >
            Disconnect
          </Button>
        )}
      </div>

      <Modal
        open={!!pending}
        onClose={() => !moving && setPending(null)}
        title="Move every set to this calendar?"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPending(null)} disabled={moving}>
              Close
            </Button>
            <Button onClick={() => pending && move(pending)} loading={moving}>
              Move sets
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          <p>
            Every upcoming set moves to <span className="font-medium">{pending?.name}</span>. Google
            emails each person a cancellation for the old invite and a new invite, and anyone
            who&rsquo;d accepted needs to accept again.
          </p>
          <p>Your other events on that calendar are never shown in TapWorship or changed.</p>
          {pickerError && <p className="text-red-600 dark:text-red-400">{pickerError}</p>}
        </div>
      </Modal>
    </div>
  );
}
