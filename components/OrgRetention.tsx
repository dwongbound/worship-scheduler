"use client";
// Org settings → Data retention: how long this workspace keeps its own
// history. Admin-only, and keyed on orgId by the parent so it remounts on an
// org switch (same shape as OrgNotifications).
//
// Changing this is the one setting on the page that DELETES things, so it
// doesn't save on pick. Choosing a window opens a confirmation that has gone
// and counted what would go — "142 sets, 1,204 roster entries" rather than
// "some older data may be removed", which is the kind of warning people click
// through. Nothing is written until that dialog is confirmed.
import { useEffect, useState } from "react";
import Button from "@/components/common/Button";
import InfoTooltip from "@/components/common/InfoTooltip";
import Modal from "@/components/common/Modal";
import Select from "@/components/common/Select";
import {
  DEFAULT_RETENTION_MONTHS,
  RETENTION_OPTIONS,
  retentionLabel,
} from "@/lib/retention";

// What GET /api/orgs/[id]/retention-preview answers with.
interface Preview {
  cutoff: string;
  sets: number;
  assignments: number;
  historyEvents: number;
  requests: number;
  responses: number;
}

// "28 September 2026" — the cutoff wants to be unmistakable, so it's spelled
// out rather than rendered as 9/28/26.
function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// "1 set" / "12 sets", with the number bolded — the counts are the point.
function count(n: number, one: string, many: string) {
  return (
    <>
      <strong>{n.toLocaleString()}</strong> {n === 1 ? one : many}
    </>
  );
}

export default function OrgRetention({ orgId }: { orgId: string }) {
  // null = not loaded yet (the page's own convention for its settings).
  const [months, setMonths] = useState<number | null>(null);
  const [lastPrunedAt, setLastPrunedAt] = useState<string | null>(null);
  // The window being confirmed, and what it would delete. Both null when no
  // dialog is up; `preview` stays null while its counts are still loading.
  const [pending, setPending] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setMonths(null);
    setError("");
    fetch(`/api/orgs/${orgId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setMonths(data.retentionMonths ?? DEFAULT_RETENTION_MONTHS);
        setLastPrunedAt(data.lastPrunedAt ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // Picking a window only ASKS. The counts are fetched while the dialog is
  // already up, so the admin isn't left looking at a frozen dropdown.
  function choose(next: number) {
    setPending(next);
    setPreview(null);
    setError("");
    fetch(`/api/orgs/${orgId}/retention-preview?months=${next}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Preview | null) => data && setPreview(data))
      .catch(() => {});
  }

  async function save() {
    if (pending === null) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/orgs/${orgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionMonths: pending }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not save that setting.");
        return;
      }
      setMonths(data.retentionMonths ?? pending);
      setPending(null);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  // Is anything actually at risk under the pending window? Lengthening it
  // deletes nothing today, and the dialog should say so rather than warning
  // about a danger that isn't there.
  const atRisk =
    !!preview && (preview.sets > 0 || preview.requests > 0);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        {/* Same weight as the Notifications heading above it — these are peer
            sections. The ⚠️ is the one thing setting it apart: it's the only
            setting on this page that deletes anything. */}
        <p className="text-sm font-medium">Data retention ⚠️</p>
        <InfoTooltip
          side="bottom"
          text="How far back this workspace keeps its own history. Past sets (with their rosters, songs and activity log) and finished availability requests are deleted once they're older than this — permanently, on a weekly sweep. Serve counts are worked out from rosters, so a shorter window also shortens the history the stats can see. People, teams, roles and recurring set types are never deleted."
        />
      </div>

      {months === null ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <>
          {/* The width goes on a WRAPPER, not through className: that prop
              lands on the <select> itself, and narrowing the select alone left
              its chevron parked at the far edge of the full-width control. */}
          <div className="max-w-xs">
            <Select
              label="Keep data for"
              value={String(months)}
              onChange={(e) => choose(Number(e.target.value))}
            >
              {RETENTION_OPTIONS.map((option) => (
                <option key={option.months} value={option.months}>
                  {option.label}
                  {option.months === DEFAULT_RETENTION_MONTHS
                    ? " (default)"
                    : ""}
                </option>
              ))}
            </Select>
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {lastPrunedAt
              ? `Last swept ${longDate(lastPrunedAt)}. Runs weekly.`
              : "Not swept yet — the first sweep runs within a week."}
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {pending !== null && (
        <Modal
          open
          onClose={() => {
            if (busy) return; // don't walk away mid-write
            setPending(null);
            setPreview(null);
          }}
          title="Change data retention?"
          subtitle={`Keeping ${retentionLabel(pending)}`}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPending(null);
                  setPreview(null);
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                variant={atRisk ? "danger" : "primary"}
                onClick={save}
                loading={busy}
                // Nothing is committed until the counts are in: confirming
                // against numbers you haven't seen is the thing this dialog
                // exists to prevent.
                disabled={!preview}
              >
                {atRisk ? "Delete and save" : "Save"}
              </Button>
            </>
          }
        >
          {!preview ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Checking what this would delete…
            </p>
          ) : (
            <div className="space-y-3 text-sm text-gray-700 dark:text-gray-300">
              <p>
                Everything in this workspace from before{" "}
                <strong>{longDate(preview.cutoff)}</strong> will be deleted, and
                anything that passes that age later will be deleted too.
              </p>

              {atRisk ? (
                <>
                  <p>Right now that means:</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      {count(preview.sets, "set", "sets")}, with{" "}
                      {count(preview.assignments, "roster entry", "roster entries")}{" "}
                      and {count(preview.historyEvents, "log entry", "log entries")}
                    </li>
                    <li>
                      {count(
                        preview.requests,
                        "availability request",
                        "availability requests"
                      )}
                      , with{" "}
                      {count(preview.responses, "response", "responses")} and the
                      dated blocks people filled in for them
                    </li>
                  </ul>
                  <p className="font-medium text-red-600 dark:text-red-400">
                    This cannot be undone. There is no archive and no export
                    afterwards.
                  </p>
                </>
              ) : (
                <p>
                  Nothing in this workspace is old enough to delete yet, so
                  saving this changes nothing today.
                </p>
              )}

              <p className="text-gray-500 dark:text-gray-400">
                People, teams, roles, recurring set types and weekly
                availability are never deleted.
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
